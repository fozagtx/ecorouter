// All amounts inside the router are integer micro-dollars (1 USD = 1_000_000).
// Integers keep cap arithmetic exact; conversion happens only at the edges.

export type Micros = number;

export const MICROS_PER_USD = 1_000_000;

export function usd(amount: number): Micros {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`invalid USD amount: ${amount}`);
  return Math.round(amount * MICROS_PER_USD);
}

export function toUsd(micros: Micros): number {
  return micros / MICROS_PER_USD;
}

export function formatUsd(micros: Micros, digits = 4): string {
  return `$${toUsd(micros).toFixed(digits)}`;
}
