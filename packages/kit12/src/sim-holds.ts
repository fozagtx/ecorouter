import type { Hold, HoldRail, Micros } from "ecorouter";

/** Card holds kept in memory with Airwallex's rules: raise to a new total, capture once, never above the hold. */
export class SimHolds implements HoldRail {
  private n = 0;

  async place(jobId: string, amount: Micros): Promise<Hold> {
    const held = Math.ceil(amount / 10_000) * 10_000; // whole cents, rounded up like the real hold
    return { intentId: `sim_int_${++this.n}`, jobId, held, status: "held", captured: 0 };
  }

  async increase(hold: Hold, newTotal: Micros): Promise<Hold> {
    if (hold.status !== "held") throw new Error(`hold ${hold.intentId} is ${hold.status}`);
    if (newTotal <= hold.held) throw new RangeError("a raised hold must be larger than the current one");
    return { ...hold, held: Math.ceil(newTotal / 10_000) * 10_000 };
  }

  async capture(hold: Hold, amount: Micros): Promise<Hold> {
    if (hold.status !== "held") throw new Error(`hold ${hold.intentId} is ${hold.status}`);
    if (amount > hold.held) throw new RangeError(`capture ${amount} is above the hold ${hold.held}`);
    return { ...hold, status: "captured", captured: amount };
  }

  async cancel(hold: Hold): Promise<Hold> {
    return hold.status === "held" ? { ...hold, status: "cancelled" } : hold;
  }
}
