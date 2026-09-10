const USDC_SCALE = 10_000_000n;

export function parseUsdc(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,7})?$/.test(value)) throw new TypeError("USDC amount must be a non-negative decimal with at most 7 places");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * USDC_SCALE + BigInt(fraction.padEnd(7, "0"));
}

export function formatUsdc(value: bigint): string {
  if (value < 0n) throw new RangeError("USDC amount cannot be negative");
  const fraction = (value % USDC_SCALE).toString().padStart(7, "0").replace(/0+$/, "");
  return `${value / USDC_SCALE}${fraction ? `.${fraction}` : ""}`;
}
