/** Stellar USDC has 7 decimals. All money stays in atomic bigint units until it is rendered. */
export const DECIMALS = 7;
export const UNIT = 10n ** BigInt(DECIMALS);

export function usd(dollars: number): bigint {
  return BigInt(Math.round(dollars * 100)) * (UNIT / 100n);
}

/** Parses "120", "$1,250.50", "0.0000001" into atomic units. Returns null when not a positive amount. */
export function parseAmount(input: string): bigint | null {
  const clean = input.replace(/[$,\s]/g, "").replace(/usdc?$/i, "");
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  if (frac.length > DECIMALS) return null;
  const atomic = BigInt(whole) * UNIT + BigInt(frac.padEnd(DECIMALS, "0") || "0");
  return atomic > 0n ? atomic : null;
}

/** $1,234.56 — always two decimals, more only when the amount needs them. */
export function fmt(atomic: bigint, opts: { sign?: boolean } = {}): string {
  const neg = atomic < 0n;
  const abs = neg ? -atomic : atomic;
  const whole = abs / UNIT;
  let frac = (abs % UNIT).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  const s = `$${whole.toLocaleString("en-US")}.${frac}`;
  if (neg) return `−${s}`;
  return opts.sign ? `+${s}` : s;
}

/** Plain decimal string for inputs ("1250.5"). */
export function toDecimal(atomic: bigint): string {
  const whole = atomic / UNIT;
  const frac = (atomic % UNIT).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function pct(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  const p = Number((part * 10000n) / whole) / 100;
  return Math.max(0, Math.min(100, p));
}
