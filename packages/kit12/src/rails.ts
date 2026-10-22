import { formatUsd, type Micros } from "ecorouter";
import { CATALOG, DEFAULT_STATE, latencyMs, quote, standInAnswer, type ProviderSpec, type ProviderState, type StepRequest } from "./catalog.js";

export interface Offer {
  providerId: string;
  /** Price in the provider's latest 402 offer, micro-dollars. */
  amount: Micros;
}

export interface StepResult {
  providerId: string;
  text: string;
  /** What this step actually paid. */
  paid: Micros;
  latencyMs: number;
}

export class PriceMovedError extends Error {
  constructor(readonly providerId: string, readonly offered: Micros, readonly limit: Micros) {
    super(`${providerId} now asks ${formatUsd(offered)}, above the ${formatUsd(limit)} this step allows`);
    this.name = "PriceMovedError";
  }
}

/** The step was paid for but produced no answer (timeout, dropped connection). The money is spent. */
export class PaidStepFailedError extends Error {
  constructor(readonly providerId: string, readonly paid: Micros, reason: string) {
    super(`${providerId} was paid ${formatUsd(paid)} but ${reason}`);
    this.name = "PaidStepFailedError";
  }
}

export class InsufficientDepositError extends Error {
  constructor(readonly jobId: string) {
    super(`job ${jobId} has too little left on deposit`);
    this.name = "InsufficientDepositError";
  }
}

/**
 * Everything the sourcing agent needs from the payment side. MetalRail pays real providers over
 * x402 with Metal clearing; SimRail runs the same rules in memory. Decision logic only sees this.
 */
export interface PaymentRail {
  readonly name: string;
  /** Read the provider's live offer for this request. Never cached. */
  offer(providerId: string, req: StepRequest): Promise<Offer>;
  openJob(jobId: string): Promise<void>;
  /** Move float into the job's clearing deposit. */
  deposit(jobId: string, amount: Micros): Promise<{ tx?: string }>;
  /** Pay for and run one step. Refuses if the provider's price is above `limit` at payment time. */
  run(jobId: string, providerId: string, req: StepRequest, limit: Micros, timeoutMs: number): Promise<StepResult>;
  /** Start or finish returning the job's unused deposit to the float. */
  withdraw(jobId: string): Promise<{ status: "waiting" | "empty" | "sent"; detail?: string }>;
  close(): Promise<void>;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** In-memory rail with the same pricing, latency and deposit rules as the live providers. */
export class SimRail implements PaymentRail {
  readonly name = "simulated";
  readonly state = new Map<string, ProviderState>();
  private readonly deposits = new Map<string, { in: Micros; spent: Micros }>();
  private readonly specs: Map<string, ProviderSpec>;

  /** `timeScale` shrinks simulated waits, e.g. 0.05 for fast tests. */
  constructor(specs: ProviderSpec[] = CATALOG, private readonly timeScale = 1) {
    this.specs = new Map(specs.map((s) => [s.id, s]));
    for (const s of specs) this.state.set(s.id, { ...DEFAULT_STATE });
  }

  private spec(id: string) {
    const s = this.specs.get(id);
    if (!s) throw new Error(`unknown provider ${id}`);
    return s;
  }

  async offer(providerId: string, req: StepRequest): Promise<Offer> {
    const st = this.state.get(providerId)!;
    if (st.down) throw new Error(`${providerId} is offline`);
    return { providerId, amount: quote(this.spec(providerId), st, req) };
  }

  async openJob(jobId: string) {
    this.deposits.set(jobId, { in: 0, spent: 0 });
  }

  async deposit(jobId: string, amount: Micros) {
    this.deposits.get(jobId)!.in += amount;
    return {};
  }

  async run(jobId: string, providerId: string, req: StepRequest, limit: Micros, timeoutMs: number): Promise<StepResult> {
    const spec = this.spec(providerId);
    const st = this.state.get(providerId)!;
    if (st.down) throw new Error(`${providerId} is offline`);
    const price = quote(spec, st, req);
    if (price > limit) throw new PriceMovedError(providerId, price, limit);
    const d = this.deposits.get(jobId)!;
    if (d.in - d.spent < price) throw new InsufficientDepositError(jobId);
    d.spent += price; // clearing pays before the provider answers
    const took = latencyMs(spec, st, req);
    if (took > timeoutMs) {
      await sleep(timeoutMs * this.timeScale);
      throw new PaidStepFailedError(providerId, price, `timed out after ${timeoutMs}ms`);
    }
    await sleep(took * this.timeScale);
    return { providerId, text: standInAnswer(spec, req).join(""), paid: price, latencyMs: took };
  }

  async withdraw(jobId: string) {
    const d = this.deposits.get(jobId);
    if (!d || d.in === d.spent) return { status: "empty" as const };
    d.in = d.spent;
    return { status: "sent" as const };
  }

  /** Spent so far by a job, as the clearing position would report it. */
  spent(jobId: string): Micros {
    return this.deposits.get(jobId)?.spent ?? 0;
  }

  async close() {}
}
