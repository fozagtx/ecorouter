const UNIT = 10_000_000n;

export function parseUsdc(value: string): bigint {
  if (!/^\d+(?:\.\d{1,7})?$/.test(value)) {
    throw new Error("USDC amount must be a non-negative decimal with at most 7 places.");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * UNIT + BigInt(fraction.padEnd(7, "0") || "0");
}

export function formatUsdc(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / UNIT;
  let fraction = (absolute % UNIT).toString().padStart(7, "0").replace(/0+$/, "");
  if (fraction.length < 2) fraction = fraction.padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
