import { Rule } from "./rules";
import type { Service } from "./types";

export function resolve(services: Service[], id: string): { payee: string } | { rule: number } {
  const service = services.find((candidate) => candidate.id === id);
  if (!service) return { rule: Rule.UnknownService };
  if (service.suspended) return { rule: Rule.ServiceSuspended };
  return { payee: service.payee };
}

export function validatePolicy(
  input: { allowance: bigint; maxPayment: bigint; period: number; maxPayments: number; expiresAt: number; services: string[] },
  now: number,
): boolean {
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
