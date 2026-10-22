import { FloatLedger, HealthTracker, formatUsd, planRation, type Hold, type HoldRail, type Micros } from "ecorouter";
import { CATALOG, type ProviderSpec, type StepKind, type StepRequest } from "./catalog.js";
import { InsufficientDepositError, PaidStepFailedError, PriceMovedError, type Offer, type PaymentRail } from "./rails.js";

export interface StepPlan {
  id: string;
  kind: StepKind;
  prompt: string;
  maxTokens?: number;
  /** Steps whose answer the customer sees directly; the judge may pay more for these. */
  important?: boolean;
}

export interface JobSpec {
  id: string;
  customer: string;
  budget: Micros;
  steps: StepPlan[];
  /** Skip providers measured slower than this. */
  latencyTargetMs: number;
}

/** The model's only say over money: whether one step is worth the premium provider. */
export interface Judge {
  worthPremium(input: { job: JobSpec; step: StepPlan; cheapest: Offer; premium: Offer; budgetLeft: Micros }): Promise<{ premium: boolean; why: string }>;
}

/** Default judge: premium only for important steps, and only if it uses under a third of what is left. */
export const ruleJudge: Judge = {
  async worthPremium({ step, premium, budgetLeft }) {
    if (!step.important) return { premium: false, why: "not a customer-facing step" };
    if (premium.amount * 3 > budgetLeft) return { premium: false, why: "premium would use over a third of the budget left" };
    return { premium: true, why: "customer-facing step, budget allows the premium provider" };
  },
};

/** A person approves raising a hold. Bound to the exact job, customer, currency and amount. */
export interface ApprovalRequest {
  jobId: string;
  customer: string;
  currency: "USD";
  currentHold: Micros;
  newHold: Micros;
  reason: string;
}
export type Approver = (req: ApprovalRequest) => Promise<boolean>;

export type AgentEvent =
  | { type: "job_opened"; jobId: string; hold: Micros }
  | { type: "deposit"; jobId: string; amount: Micros; tx?: string }
  | { type: "quotes"; jobId: string; stepId: string; offers: Array<Offer & { skip?: string }> }
  | { type: "judge"; jobId: string; stepId: string; premium: boolean; why: string }
  | { type: "step_paid"; jobId: string; stepId: string; providerId: string; paid: Micros; latencyMs: number; rerouted: string[] }
  | { type: "reroute"; jobId: string; stepId: string; from: string; reason: string }
  | { type: "ration"; jobId: string; action: string; detail: string }
  | { type: "approval"; jobId: string; request: ApprovalRequest; approved: boolean }
  | { type: "job_paused"; jobId: string; reason: string }
  | { type: "job_settled"; jobId: string; captured: Micros; released: Micros; withdraw: string }
  | { type: "job_failed"; jobId: string; reason: string };

export interface AgentConfig {
  rail: PaymentRail;
  holds: HoldRail;
  ledger: FloatLedger;
  providers?: ProviderSpec[];
  judge?: Judge;
  approve: Approver;
  onEvent?: (e: AgentEvent) => void;
  /** Give up on a paid step after this long (default 4x the job's latency target) and reroute. */
  stepTimeoutMs?: number;
  /** How long a paused job waits for float before failing. */
  pauseTimeoutMs?: number;
}

export interface JobReport {
  jobId: string;
  status: "done" | "failed";
  answer: string[];
  spent: Micros;
  captured: Micros;
}

/**
 * Kit 12 Inference Sourcing Agent. Rules live here in code: budgets, the float floor,
 * the price limit on every payment, rerouting, rationing. The judge only picks premium-or-not.
 */
export class SourcingAgent {
  readonly health = new HealthTracker({ maxFailures: 2, cooldownMs: 30_000 });
  private readonly holdsByJob = new Map<string, Hold>();
  /** Start times of calls still running, per provider: a call already past the target is evidence of slowness now. */
  private readonly inFlight = new Map<string, Set<number>>();
  private readonly specs: ProviderSpec[];
  private readonly judge: Judge;

  constructor(private readonly cfg: AgentConfig) {
    this.specs = cfg.providers ?? CATALOG;
    this.judge = cfg.judge ?? ruleJudge;
  }

  private emit(e: AgentEvent) {
    this.cfg.onEvent?.(e);
  }

  /** Run every job at once; the float is shared, so they compete for it. */
  async runAll(jobs: JobSpec[]): Promise<JobReport[]> {
    for (const job of jobs) {
      const hold = await this.cfg.holds.place(job.id, job.budget);
      this.holdsByJob.set(job.id, hold);
      this.cfg.ledger.openJob(job.id, job.customer, hold.held);
      await this.cfg.rail.openJob(job.id);
      this.emit({ type: "job_opened", jobId: job.id, hold: hold.held });
    }
    return Promise.all(jobs.map((j) => this.runJob(j)));
  }

  private async runJob(job: JobSpec): Promise<JobReport> {
    const answer: string[] = [];
    try {
      for (const step of job.steps) {
        answer.push(await this.runStep(job, step));
      }
      return await this.settle(job, answer, false);
    } catch (err) {
      this.emit({ type: "job_failed", jobId: job.id, reason: err instanceof Error ? err.message : String(err) });
      return await this.settle(job, answer, true);
    }
  }

  private request(step: StepPlan): StepRequest {
    return { kind: step.kind, prompt: step.prompt, maxTokens: step.maxTokens };
  }

  /** Live offers from every healthy provider of this kind, cheapest first, with skip reasons. */
  private async offers(job: JobSpec, step: StepPlan) {
    const req = this.request(step);
    const all: Array<Offer & { skip?: string; tier: ProviderSpec["tier"] }> = [];
    for (const spec of this.specs.filter((s) => s.kind === step.kind)) {
      if (!this.health.healthy(spec.id)) {
        all.push({ providerId: spec.id, amount: Number.NaN, skip: "unhealthy", tier: spec.tier });
        continue;
      }
      try {
        const o = await this.cfg.rail.offer(spec.id, req);
        const measured = this.health.latency(spec.id);
        const oldest = Math.min(...(this.inFlight.get(spec.id) ?? []));
        const runningFor = Number.isFinite(oldest) ? Date.now() - oldest : 0;
        const skip =
          measured !== null && measured > job.latencyTargetMs
            ? `slow (${measured}ms)`
            : runningFor > job.latencyTargetMs
              ? `slow (call in flight ${runningFor}ms)`
              : undefined;
        all.push({ ...o, skip, tier: spec.tier });
      } catch (err) {
        this.health.failure(spec.id);
        all.push({ providerId: spec.id, amount: Number.NaN, skip: "no offer", tier: spec.tier });
      }
    }
    all.sort((a, b) => (a.amount || Infinity) - (b.amount || Infinity));
    this.emit({ type: "quotes", jobId: job.id, stepId: step.id, offers: all.map(({ tier, ...o }) => o) });
    return all;
  }

  private async runStep(job: JobSpec, step: StepPlan): Promise<string> {
    const ledger = this.cfg.ledger;
    const req = this.request(step);
    const rerouted: string[] = [];

    for (let attempt = 0; attempt < 6; attempt++) {
      const offers = (await this.offers(job, step)).filter((o) => !o.skip);
      if (offers.length === 0) throw new Error(`no provider can serve ${step.id}`);
      const cheapest = offers[0];

      // The job's hold must cover the cheapest way to do this step; if not, the customer decides.
      if (cheapest.amount > ledger.budgetLeft(job.id)) {
        await this.askToRaise(
          job,
          cheapest.amount - ledger.budgetLeft(job.id),
          `step ${step.id} costs ${formatUsd(cheapest.amount)} at the cheapest provider, ${formatUsd(ledger.budgetLeft(job.id))} left on the hold`,
        );
        continue;
      }

      let pick = cheapest;
      const premium = offers.find((o) => o.tier === "premium" && o.providerId !== cheapest.providerId);
      if (premium && premium.amount <= ledger.budgetLeft(job.id)) {
        const verdict = await this.judge.worthPremium({ job, step, cheapest, premium, budgetLeft: ledger.budgetLeft(job.id) });
        this.emit({ type: "judge", jobId: job.id, stepId: step.id, premium: verdict.premium, why: verdict.why });
        if (verdict.premium) pick = premium;
      }

      // Make sure the clearing deposit covers this step; ration the float if it is short.
      if (!(await this.ensureDeposit(job, pick.amount))) {
        if (pick === cheapest || !(await this.ensureDeposit(job, cheapest.amount))) {
          await this.waitForFloat(job, cheapest.amount);
          continue; // prices may have moved while waiting: read fresh offers
        }
        pick = cheapest;
      }

      // Clearing pays before the provider answers, so abandoning a slow call never saves money.
      // Let it finish and route later steps away; the hard timeout is only a safety net.
      const timeoutMs = this.cfg.stepTimeoutMs ?? job.latencyTargetMs * 4;
      const started = Date.now();
      const flights = this.inFlight.get(pick.providerId) ?? new Set<number>();
      this.inFlight.set(pick.providerId, flights);
      flights.add(started);
      try {
        const result = await this.cfg.rail.run(job.id, pick.providerId, req, pick.amount, timeoutMs);
        this.health.success(pick.providerId, result.latencyMs);
        ledger.spend(job.id, result.paid);
        this.emit({ type: "step_paid", jobId: job.id, stepId: step.id, providerId: pick.providerId, paid: result.paid, latencyMs: result.latencyMs, rerouted });
        return result.text;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (err instanceof InsufficientDepositError) continue;
        if (err instanceof PaidStepFailedError) {
          ledger.spend(job.id, err.paid);
          // Paid and got nothing back: record it as at least as slow as the timeout so no job pays it again.
          this.health.seed(pick.providerId, timeoutMs);
        }
        if (!(err instanceof PriceMovedError)) this.health.failure(pick.providerId);
        rerouted.push(pick.providerId);
        this.emit({ type: "reroute", jobId: job.id, stepId: step.id, from: pick.providerId, reason });
      } finally {
        flights.delete(started);
      }
    }
    throw new Error(`step ${step.id} could not be completed`);
  }

  /** Top up the job's deposit from the float. Returns false when the float cannot cover it right now. */
  private async ensureDeposit(job: JobSpec, needed: Micros): Promise<boolean> {
    const ledger = this.cfg.ledger;
    const gap = needed - ledger.depositLeft(job.id);
    if (gap <= 0) return true;
    // Deposit exactly what this step needs: float sitting in one job's deposit is not there for the others.
    if (!ledger.deposit(job.id, gap)) return false;
    const { tx } = await this.cfg.rail.deposit(job.id, gap);
    this.emit({ type: "deposit", jobId: job.id, amount: gap, tx });
    return true;
  }

  /** The float is short: pause this job (in code, per planRation) until another job returns float. */
  private async waitForFloat(job: JobSpec, needed: Micros) {
    const ledger = this.cfg.ledger;
    const gap = needed - ledger.depositLeft(job.id);
    const plan = planRation(ledger, [{ jobId: job.id, cheapest: gap, preferred: gap }]);
    const mine = plan.find((p) => p.jobId === job.id);
    this.emit({ type: "ration", jobId: job.id, action: mine?.action ?? "pause", detail: mine?.reason ?? "" });
    ledger.setStatus(job.id, "paused");
    this.emit({ type: "job_paused", jobId: job.id, reason: `float has ${formatUsd(ledger.free())} free above the floor, step needs ${formatUsd(gap)}` });
    const deadline = Date.now() + (this.cfg.pauseTimeoutMs ?? 120_000);
    while (ledger.free() < gap) {
      // Float only comes back when another job settles. With none left running, waiting cannot help.
      const others = ledger.list().filter((j) => j.id !== job.id && (j.status === "running" || j.status === "paused" || j.status === "waiting_for_customer"));
      if (others.length === 0) throw new Error(`float cannot cover this job: ${formatUsd(ledger.free())} free, step needs ${formatUsd(gap)}`);
      if (Date.now() > deadline) throw new Error("float stayed below what this job needs");
      await new Promise((r) => setTimeout(r, 50));
    }
    ledger.setStatus(job.id, "running");
  }

  /** Ask the customer to raise their hold by exactly what the job is short. */
  private async askToRaise(job: JobSpec, shortBy: Micros, reason: string) {
    const ledger = this.cfg.ledger;
    const hold = this.holdsByJob.get(job.id)!;
    const request: ApprovalRequest = {
      jobId: job.id,
      customer: job.customer,
      currency: "USD",
      currentHold: hold.held,
      newHold: hold.held + shortBy,
      reason,
    };
    ledger.setStatus(job.id, "waiting_for_customer");
    const approved = await this.cfg.approve(request);
    this.emit({ type: "approval", jobId: job.id, request, approved });
    if (!approved) throw new Error(`customer declined raising the hold to ${formatUsd(request.newHold)}`);
    const raised = await this.cfg.holds.increase(hold, request.newHold);
    this.holdsByJob.set(job.id, raised);
    ledger.raiseBudget(job.id, raised.held);
  }

  /** Capture what the job spent, release the rest, return the unused deposit to the float. */
  private async settle(job: JobSpec, answer: string[], failed: boolean): Promise<JobReport> {
    const ledger = this.cfg.ledger;
    const s = ledger.settle(job.id, failed);
    let hold = this.holdsByJob.get(job.id)!;
    hold = s.capture > 0 ? await this.cfg.holds.capture(hold, s.capture) : await this.cfg.holds.cancel(hold, "job spent nothing");
    this.holdsByJob.set(job.id, hold);
    const w = await this.cfg.rail.withdraw(job.id);
    this.emit({ type: "job_settled", jobId: job.id, captured: hold.captured, released: hold.held - hold.captured, withdraw: w.status });
    return { jobId: job.id, status: failed ? "failed" : "done", answer, spent: s.capture, captured: hold.captured };
  }
}
