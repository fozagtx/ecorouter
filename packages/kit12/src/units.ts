import type { Micros } from "ecorouter";

/** One micro-dollar is one Metal clearing unit: 1e12 USDZ base units (USDZ has 18 decimals). */
const BASE_PER_MICRO = 10n ** 12n;

export function microsToBase(micros: Micros): bigint {
  if (!Number.isInteger(micros) || micros < 0) throw new RangeError(`invalid micros ${micros}`);
  return BigInt(micros) * BASE_PER_MICRO;
}

/** Base units to micro-dollars. Throws on a fraction of a clearing unit rather than rounding money. */
export function baseToMicros(base: bigint | string): Micros {
  const b = BigInt(base);
  if (b % BASE_PER_MICRO !== 0n) throw new RangeError(`${b} is not a whole number of clearing units`);
  return Number(b / BASE_PER_MICRO);
}
