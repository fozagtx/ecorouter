import { InvalidPaymentChallengeError, MandateExceededError, MandateExpiredError, MandateRevokedError, PolicyExceededError } from "../errors.js";
import { parseUsdc } from "../money.js";
import type { MandateState, PaymentChallenge } from "../types.js";

export function validateChallenge(challenge: PaymentChallenge, mandate: MandateState, maxSpend: string, executionId?: string): bigint {
  if (challenge.x402Version !== 2 || challenge.scheme !== "exact" || challenge.network !== "stellar:testnet" || challenge.asset !== mandate.asset || !challenge.payTo) {
    throw new InvalidPaymentChallengeError("Unsupported x402 payment requirements", executionId);
  }
  let amount: bigint;
  try { amount = BigInt(challenge.amount); } catch { throw new InvalidPaymentChallengeError("Payment amount is not an atomic integer", executionId); }
  if (amount <= 0n) throw new InvalidPaymentChallengeError("Payment amount must be positive", executionId);
  if (mandate.revoked) throw new MandateRevokedError(undefined, executionId);
  if (mandate.expiresAt <= Math.floor(Date.now() / 1000)) throw new MandateExpiredError(undefined, executionId);
  if (amount > parseUsdc(maxSpend)) throw new PolicyExceededError(undefined, executionId);
  if (amount > mandate.maxPaymentAtomic || amount > mandate.remainingAtomic) throw new MandateExceededError(undefined, executionId);
  return amount;
}
