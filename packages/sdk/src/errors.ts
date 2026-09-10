export type ArbiterErrorCode =
  | "NO_ELIGIBLE_PROVIDER" | "INVALID_PAYMENT_CHALLENGE" | "POLICY_EXCEEDED"
  | "MANDATE_EXCEEDED" | "MANDATE_EXPIRED" | "MANDATE_REVOKED"
  | "PAYMENT_AUTHORIZATION_ERROR" | "PAYMENT_SETTLEMENT_ERROR"
  | "PAYMENT_SETTLEMENT_UNKNOWN" | "PROVIDER_EXECUTION_ERROR" | "PROVIDER_RESPONSE_ERROR";

export class ArbiterError extends Error {
  constructor(public readonly code: ArbiterErrorCode, message: string, public readonly executionId?: string) {
    super(message); this.name = new.target.name;
  }
}
const error = (name: string, code: ArbiterErrorCode) => class extends ArbiterError {
  constructor(message = name, executionId?: string) { super(code, message, executionId); }
};
export const NoEligibleProviderError = error("No eligible provider", "NO_ELIGIBLE_PROVIDER");
export const InvalidPaymentChallengeError = error("Invalid payment challenge", "INVALID_PAYMENT_CHALLENGE");
export const PolicyExceededError = error("Policy exceeded", "POLICY_EXCEEDED");
export const MandateExceededError = error("Mandate exceeded", "MANDATE_EXCEEDED");
export const MandateExpiredError = error("Mandate expired", "MANDATE_EXPIRED");
export const MandateRevokedError = error("Mandate revoked", "MANDATE_REVOKED");
export const PaymentAuthorizationError = error("Payment authorization failed", "PAYMENT_AUTHORIZATION_ERROR");
export const PaymentSettlementError = error("Payment settlement failed", "PAYMENT_SETTLEMENT_ERROR");
export class PaymentSettlementUnknownError extends ArbiterError {
  constructor(message: string, executionId?: string, public readonly providerId?: string, public readonly transactionHash?: string, public readonly paymentMetadata?: unknown) {
    super("PAYMENT_SETTLEMENT_UNKNOWN", message, executionId);
  }
}
export const ProviderExecutionError = error("Provider execution failed", "PROVIDER_EXECUTION_ERROR");
export const ProviderResponseError = error("Provider response invalid", "PROVIDER_RESPONSE_ERROR");
