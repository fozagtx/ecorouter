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
const createError = (name: string, code: ArbiterErrorCode, defaultMessage: string) => {
  const cls = class extends ArbiterError {
    constructor(message = defaultMessage, executionId?: string) {
      super(code, message, executionId);
      this.name = name;
    }
  };
  Object.defineProperty(cls, "name", { value: name });
  return cls;
};
export const NoEligibleProviderError = createError("NoEligibleProviderError", "NO_ELIGIBLE_PROVIDER", "No eligible provider");
export const InvalidPaymentChallengeError = createError("InvalidPaymentChallengeError", "INVALID_PAYMENT_CHALLENGE", "Invalid payment challenge");
export const PolicyExceededError = createError("PolicyExceededError", "POLICY_EXCEEDED", "Policy exceeded");
export const MandateExceededError = createError("MandateExceededError", "MANDATE_EXCEEDED", "Mandate exceeded");
export const MandateExpiredError = createError("MandateExpiredError", "MANDATE_EXPIRED", "Mandate expired");
export const MandateRevokedError = createError("MandateRevokedError", "MANDATE_REVOKED", "Mandate revoked");
export const PaymentAuthorizationError = createError("PaymentAuthorizationError", "PAYMENT_AUTHORIZATION_ERROR", "Payment authorization failed");
export const PaymentSettlementError = createError("PaymentSettlementError", "PAYMENT_SETTLEMENT_ERROR", "Payment settlement failed");
export class PaymentSettlementUnknownError extends ArbiterError {
  constructor(message: string, executionId?: string, public readonly providerId?: string, public readonly transactionHash?: string, public readonly paymentMetadata?: unknown) {
    super("PAYMENT_SETTLEMENT_UNKNOWN", message, executionId);
    this.name = "PaymentSettlementUnknownError";
  }
}
export const ProviderExecutionError = createError("ProviderExecutionError", "PROVIDER_EXECUTION_ERROR", "Provider execution failed");
export const ProviderResponseError = createError("ProviderResponseError", "PROVIDER_RESPONSE_ERROR", "Provider response invalid");
