/**
 * A line-for-line TypeScript mirror of the team-account contract's checks.
 * The sandbox runs on it, and the testnet app uses the contract's own `check`
 * instead. Keep the order identical to `evaluate` in contracts/team-account.
 */
import { Rule } from "./rules";
import type { Policy, Service, Usage, Verdict } from "./types";

export interface EvalInput {
  accountPaused: boolean;
  policy: Policy | undefined;
  storedUsage: Usage | undefined;
  service: string;
  amount: bigint;
  now: number;
  /** Set when evaluating a real payment; undefined for a dry run. */
  keyUsed?: boolean;
}

export type EvalResult =
  | { ok: true; usage: Usage; policy: Policy }
  | { ok: false; rule: number; overBy: bigint };

export function currentUsage(policy: Policy, stored: Usage | undefined, now: number): Usage {
  const start =
    now <= policy.anchor
      ? policy.anchor
      : policy.anchor + Math.floor((now - policy.anchor) / policy.period) * policy.period;
  if (stored && stored.periodStart === start) return stored;
  return { periodStart: start, spent: 0n, count: 0 };
}

export function evaluate(i: EvalInput): EvalResult {
  if (i.accountPaused) return refuse(Rule.AccountPaused);
  const p = i.policy;
  if (!p) return refuse(Rule.UnknownSpender);
  if (p.paused) return refuse(Rule.SpenderPaused);
  if (i.now >= p.expiresAt) return refuse(Rule.PolicyExpired);
  if (i.amount <= 0n) return refuse(Rule.InvalidAmount);
  if (!p.services.includes(i.service)) return refuse(Rule.ServiceNotAllowed, i.amount);
  if (i.keyUsed) return refuse(Rule.DuplicatePayment);
  if (i.amount > p.maxPayment) return refuse(Rule.OverPaymentCap, i.amount - p.maxPayment);
  const usage = currentUsage(p, i.storedUsage, i.now);
  if (usage.count >= p.maxPayments) return refuse(Rule.OverFrequency, 1n);
  const after = usage.spent + i.amount;
  if (after > p.allowance) return refuse(Rule.OverAllowance, after - p.allowance);
  return { ok: true, usage, policy: p };
}

/** Registry lookup, as `ServiceRegistry.resolve` does it. */
export function resolve(services: Service[], id: string): { payee: string } | { rule: number } {
  const s = services.find((x) => x.id === id);
  if (!s) return { rule: Rule.UnknownService };
  if (s.suspended) return { rule: Rule.ServiceSuspended };
  return { payee: s.payee };
}

/** The contract's `check`: policy, then registry, then balance. */
export function verdict(
  i: EvalInput & { services: Service[]; balance: bigint },
): Verdict {
  const r = evaluate(i);
  if (!r.ok) {
    const usage = i.policy ? currentUsage(i.policy, i.storedUsage, i.now) : { spent: 0n, count: 0 };
    return {
      rule: r.rule,
      overBy: r.overBy,
      allowanceLeft: i.policy ? i.policy.allowance - usage.spent : 0n,
      periodSpent: usage.spent,
      periodCount: usage.count,
    };
  }
  const res = resolve(i.services, i.service);
  let rule: number = Rule.Ok;
  if ("rule" in res) rule = res.rule;
  else if (i.balance < i.amount) rule = Rule.InsufficientFunds;
  return {
    rule,
    overBy: 0n,
    allowanceLeft: r.policy.allowance - r.usage.spent,
    periodSpent: r.usage.spent,
    periodCount: r.usage.count,
  };
}

export function validatePolicy(input: { allowance: bigint; maxPayment: bigint; period: number; maxPayments: number; expiresAt: number; services: string[] }, now: number): boolean {
  return !(
    input.allowance <= 0n ||
    input.maxPayment <= 0n ||
    input.maxPayment > input.allowance ||
    input.period <= 0 ||
    input.maxPayments <= 0 ||
    input.expiresAt <= now ||
    input.services.length > 32
  );
}

function refuse(rule: number, overBy: bigint = 0n): EvalResult {
  return { ok: false, rule, overBy };
}
