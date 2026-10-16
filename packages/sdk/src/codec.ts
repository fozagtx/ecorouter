import type { Policy, Receipt, Usage, Verdict } from "./index.js";

type NativeRecord = Record<string, unknown> | Map<unknown, unknown>;

function field(value: unknown, name: string): unknown {
  if (value instanceof Map) return value.get(name) ?? value.get(name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return record[name] ?? record[name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)];
  }
  throw new Error(`Expected a contract struct while decoding ${name}.`);
}

function record(value: unknown): asserts value is NativeRecord {
  if (!value || typeof value !== "object") throw new Error("Expected a contract struct.");
}

const integer = (value: unknown) => Number(value);
const bigInteger = (value: unknown) => BigInt(value as bigint | number | string);
const hexBytes = (value: unknown) => Buffer.from(value as Uint8Array).toString("hex");

export function decodePolicy(value: unknown): Policy {
  record(value);
  return {
    kind: integer(field(value, "kind")) === 1 ? "agent" : "person",
    signer: hexBytes(field(value, "signer")),
    label: String(field(value, "label")),
    allowance: bigInteger(field(value, "allowance")),
    period: integer(field(value, "period")),
    maxPayment: bigInteger(field(value, "maxPayment")),
    maxPayments: integer(field(value, "maxPayments")),
    expiresAt: integer(field(value, "expiresAt")),
    services: Array.from(field(value, "services") as Iterable<unknown>, String),
    paused: Boolean(field(value, "paused")),
    anchor: integer(field(value, "anchor")),
  };
}

export function decodeUsage(value: unknown): Usage {
  record(value);
  return {
    periodStart: integer(field(value, "periodStart")),
    spent: bigInteger(field(value, "spent")),
    count: integer(field(value, "count")),
  };
}

export function decodeVerdict(value: unknown): Verdict {
  record(value);
  return {
    rule: integer(field(value, "rule")),
    overBy: bigInteger(field(value, "overBy")),
    allowanceLeft: bigInteger(field(value, "allowanceLeft")),
    periodSpent: bigInteger(field(value, "periodSpent")),
    periodCount: integer(field(value, "periodCount")),
  };
}

export function decodeReceipt(value: unknown): Receipt {
  record(value);
  return {
    spender: String(field(value, "spender")),
    service: String(field(value, "service")),
    payee: String(field(value, "payee")),
    amount: bigInteger(field(value, "amount")),
    memo: String(field(value, "memo")),
    periodSpent: bigInteger(field(value, "periodSpent")),
    allowanceLeft: bigInteger(field(value, "allowanceLeft")),
    at: integer(field(value, "at")),
  };
}
