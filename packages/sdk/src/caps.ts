import type { Micros } from "./money.js";
import type { AgentPolicy, Period } from "./types.js";

const PERIOD_MS: Record<Period, number> = {
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

interface Hold {
  agentId: string;
  runId?: string;
  amount: Micros;
}

/**
 * Tracks spend against each agent's period cap and each run's budget.
 * Money is reserved before a provider is called and settled to the real cost after,
 * so two concurrent steps cannot both spend the last of a cap.
 */
export class CapLedger {
  private readonly policies = new Map<string, AgentPolicy>();
  private readonly spent = new Map<string, { windowStart: number; amount: Micros }>();
  private readonly runs = new Map<string, { budget: Micros; spent: Micros }>();
  private readonly holds = new Map<string, Hold>();
  private nextHold = 1;

  constructor(private readonly now: () => number = Date.now) {}

  setPolicy(policy: AgentPolicy): void {
    if (policy.periodCap <= 0 || policy.stepCeiling <= 0) throw new RangeError("caps must be above zero");
    this.policies.set(policy.agentId, policy);
  }

  policy(agentId: string): AgentPolicy | undefined {
    return this.policies.get(agentId);
  }

  pause(agentId: string, paused = true): void {
    const p = this.policies.get(agentId);
    if (p) p.paused = paused;
  }

  openRun(runId: string, budget: Micros): void {
    if (budget <= 0) throw new RangeError("run budget must be above zero");
    this.runs.set(runId, { budget, spent: 0 });
  }

  /** Spend left in the current period, counting money reserved for calls in flight. */
  periodLeft(agentId: string): Micros {
    const p = this.policies.get(agentId);
    if (!p) return 0;
    return Math.max(0, p.periodCap - this.windowSpent(agentId, p.period) - this.held((h) => h.agentId === agentId));
  }

  runLeft(runId: string): Micros | null {
    const r = this.runs.get(runId);
    if (!r) return null;
    return Math.max(0, r.budget - r.spent - this.held((h) => h.runId === runId));
  }

  /** Reserve an estimate before calling a provider. Returns a hold id, or null if it does not fit. */
  reserve(agentId: string, amount: Micros, runId?: string): string | null {
    if (amount > this.periodLeft(agentId)) return null;
    if (runId !== undefined) {
      const left = this.runLeft(runId);
      if (left !== null && amount > left) return null;
    }
    const id = `h${this.nextHold++}`;
    this.holds.set(id, { agentId, runId, amount });
    return id;
  }

  /** Replace a hold with what the call actually cost. */
  settle(holdId: string, actual: Micros): void {
    const h = this.holds.get(holdId);
    if (!h) throw new Error(`unknown hold ${holdId}`);
    this.holds.delete(holdId);
    const p = this.policies.get(h.agentId);
    if (p) {
      const w = this.window(h.agentId, p.period);
      w.amount += actual;
    }
    if (h.runId !== undefined) {
      const r = this.runs.get(h.runId);
      if (r) r.spent += actual;
    }
  }

  /** Drop a hold without spending, e.g. when the provider call failed and nothing was charged. */
  release(holdId: string): void {
    this.holds.delete(holdId);
  }

  private held(match: (h: Hold) => boolean): Micros {
    let sum = 0;
    for (const h of this.holds.values()) if (match(h)) sum += h.amount;
    return sum;
  }

  private windowSpent(agentId: string, period: Period): Micros {
    return this.window(agentId, period).amount;
  }

  private window(agentId: string, period: Period) {
    const now = this.now();
    let w = this.spent.get(agentId);
    if (!w || now - w.windowStart >= PERIOD_MS[period]) {
      w = { windowStart: now, amount: 0 };
      this.spent.set(agentId, w);
    }
    return w;
  }
}
