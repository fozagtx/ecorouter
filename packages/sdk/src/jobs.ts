import type { Micros } from "./money.js";

/**
 * Kit 12 money model, all in integer micro-dollars:
 * - each job has a budget backed by the customer's card hold (Airwallex),
 * - providers are paid from a per-job clearing deposit (Metal),
 * - deposits come out of one shared float that must never drop below its floor.
 */

export type JobStatus = "running" | "waiting_for_customer" | "paused" | "done" | "failed";

export interface Job {
  id: string;
  customer: string;
  /** What the customer's card hold covers. */
  budget: Micros;
  /** Moved from the float into this job's clearing deposit. */
  deposited: Micros;
  /** Paid to providers so far (from the clearing position). */
  spent: Micros;
  status: JobStatus;
}

export interface JobSettlement {
  jobId: string;
  /** Capture this much on the card hold, once. */
  capture: Micros;
  /** Release the rest of the hold. */
  release: Micros;
  /** Withdraw this much unused deposit back to the float. */
  withdraw: Micros;
}

export class FloatLedger {
  private readonly jobs = new Map<string, Job>();
  private float: Micros;

  constructor(
    float: Micros,
    /** The float never goes below this, so the operator keeps working capital. */
    readonly floor: Micros,
  ) {
    if (floor < 0 || float < floor) throw new RangeError("float must be at least the floor");
    this.float = float;
  }

  /** Float not yet deposited into any job, above the floor. */
  free(): Micros {
    return Math.max(0, this.float - this.floor);
  }

  /** Total float held by the operator right now (outside clearing). */
  balance(): Micros {
    return this.float;
  }

  openJob(id: string, customer: string, budget: Micros): Job {
    if (this.jobs.has(id)) throw new Error(`job ${id} already exists`);
    if (budget <= 0) throw new RangeError("budget must be above zero");
    const job: Job = { id, customer, budget, deposited: 0, spent: 0, status: "running" };
    this.jobs.set(id, job);
    return job;
  }

  job(id: string): Job {
    const j = this.jobs.get(id);
    if (!j) throw new Error(`unknown job ${id}`);
    return j;
  }

  list(): Job[] {
    return [...this.jobs.values()];
  }

  /** Budget left on the customer's hold. */
  budgetLeft(id: string): Micros {
    const j = this.job(id);
    return Math.max(0, j.budget - j.spent);
  }

  /** Deposit left in the job's clearing balance. */
  depositLeft(id: string): Micros {
    const j = this.job(id);
    return Math.max(0, j.deposited - j.spent);
  }

  /** Move float into a job's clearing deposit. Refused if it would cross the floor or the job's budget. */
  deposit(id: string, amount: Micros): boolean {
    const j = this.job(id);
    if (amount <= 0 || amount > this.free() || j.deposited + amount > j.budget) return false;
    this.float -= amount;
    j.deposited += amount;
    return true;
  }

  /** Record a provider payment, as reported by the clearing position. */
  spend(id: string, amount: Micros): void {
    const j = this.job(id);
    if (j.spent + amount > j.deposited) throw new RangeError(`job ${id} would spend past its deposit`);
    j.spent += amount;
  }

  /** The customer approved a larger hold. */
  raiseBudget(id: string, budget: Micros): void {
    const j = this.job(id);
    if (budget <= j.budget) throw new RangeError("a raised budget must be larger");
    j.budget = budget;
    if (j.status === "waiting_for_customer") j.status = "running";
  }

  setStatus(id: string, status: JobStatus): void {
    this.job(id).status = status;
  }

  /** Close a job: capture what it spent, release the rest of the hold, withdraw the unused deposit. */
  settle(id: string, failed = false): JobSettlement {
    const j = this.job(id);
    const withdraw = j.deposited - j.spent;
    this.float += withdraw;
    j.status = failed ? "failed" : "done";
    return { jobId: id, capture: j.spent, release: j.budget - j.spent, withdraw };
  }
}

export interface JobNeed {
  jobId: string;
  /** Estimated cost to finish at the cheapest provider that meets the job's speed target. */
  cheapest: Micros;
  /** Estimated cost to finish at the provider the job would prefer (e.g. a better model). */
  preferred: Micros;
}

export type RationAction =
  | { jobId: string; action: "fund"; amount: Micros; provider: "preferred" | "cheapest"; reason: string }
  | { jobId: string; action: "ask_raise_hold"; newBudget: Micros; reason: string }
  | { jobId: string; action: "pause"; reason: string };

/**
 * Decide, in code, how to split a short float between running jobs.
 * 1. A job whose cheapest finish exceeds its budget needs the customer: ask to raise the hold by the exact gap.
 * 2. Remaining jobs are funded in order of smallest cheapest-finish, so the most jobs complete.
 * 3. A funded job gets its preferred provider only if the float still covers every other fundable job at cheapest.
 * 4. Jobs the float cannot cover are paused, not failed, until a withdrawal frees float.
 * The model may override step 3 (which answers are worth the expensive provider) through a typed tool,
 * but never steps 1, 2 or 4.
 */
export function planRation(ledger: FloatLedger, needs: JobNeed[]): RationAction[] {
  const actions: RationAction[] = [];
  const fundable: Array<JobNeed & { gapCheap: Micros; gapPreferred: Micros }> = [];

  for (const n of needs) {
    const j = ledger.job(n.jobId);
    if (j.status !== "running") continue;
    const left = ledger.budgetLeft(n.jobId);
    if (n.cheapest > left) {
      actions.push({
        jobId: n.jobId,
        action: "ask_raise_hold",
        newBudget: j.spent + n.cheapest,
        reason: `needs ${n.cheapest} to finish at the cheapest provider, ${left} left on the hold`,
      });
      continue;
    }
    const onDeposit = ledger.depositLeft(n.jobId);
    fundable.push({
      ...n,
      gapCheap: Math.max(0, n.cheapest - onDeposit),
      gapPreferred: Math.max(0, Math.min(n.preferred, left) - onDeposit),
    });
  }

  fundable.sort((a, b) => a.gapCheap - b.gapCheap);
  let free = ledger.free();

  for (let i = 0; i < fundable.length; i++) {
    const f = fundable[i];
    if (f.gapCheap > free) {
      actions.push({ jobId: f.jobId, action: "pause", reason: `float has ${free} free above the floor, job needs ${f.gapCheap}` });
      continue;
    }
    // Jobs still waiting, funded at their cheapest, must fit in what this job leaves behind.
    const restCheap = fundable.slice(i + 1).reduce((s, r) => s + r.gapCheap, 0);
    const canPrefer = f.gapPreferred > f.gapCheap && f.gapPreferred <= free - Math.min(restCheap, free - f.gapCheap);
    const amount = canPrefer ? f.gapPreferred : f.gapCheap;
    free -= amount;
    actions.push({
      jobId: f.jobId,
      action: "fund",
      amount,
      provider: canPrefer ? "preferred" : "cheapest",
      reason: canPrefer ? "float covers the preferred provider and every other job" : "float only stretches to the cheapest provider",
    });
  }
  return actions;
}
