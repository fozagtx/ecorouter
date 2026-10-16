/** Error codes of the team-account contract (`AccountError`), with the words the app uses for them. */
export const Rule = {
  Ok: 0,
  AccountPaused: 1,
  UnknownSpender: 2,
  SpenderPaused: 3,
  PolicyExpired: 4,
  InvalidAmount: 5,
  ServiceNotAllowed: 6,
  DuplicatePayment: 7,
  OverPaymentCap: 8,
  OverFrequency: 9,
  OverAllowance: 10,
  UnknownService: 11,
  ServiceSuspended: 12,
  InsufficientFunds: 13,
  InvalidPolicy: 14,
  UnknownRequest: 15,
  RequestNotPending: 16,
  RequestNotApproved: 17,
  RequestExpired: 18,
  PayeeChanged: 19,
  NotAuthorized: 20,
  NoExceptionNeeded: 21,
  NotEligibleForException: 22,
  AgentCannotRequest: 23,
  RegistryUnavailable: 24,
  NoPendingOwner: 25,
} as const;

export type RuleCode = (typeof Rule)[keyof typeof Rule];

const COPY: Record<number, { title: string; detail: string }> = {
  [Rule.AccountPaused]: { title: "Account paused", detail: "The owner has paused the whole account. Nothing can be paid." },
  [Rule.UnknownSpender]: { title: "Not a spender", detail: "This address has no policy on the account." },
  [Rule.SpenderPaused]: { title: "Spender paused", detail: "The owner paused this spender." },
  [Rule.PolicyExpired]: { title: "Policy expired", detail: "This spender's policy has passed its end date." },
  [Rule.InvalidAmount]: { title: "Invalid amount", detail: "The amount must be more than zero." },
  [Rule.ServiceNotAllowed]: { title: "Service not on the list", detail: "This service is not on the spender's approved list." },
  [Rule.DuplicatePayment]: { title: "Already submitted", detail: "This payment key was used before, so it cannot pay twice." },
  [Rule.OverPaymentCap]: { title: "Over the per-payment cap", detail: "One payment cannot be larger than the spender's cap." },
  [Rule.OverFrequency]: { title: "Too many payments this period", detail: "The spender has used every payment allowed in this period." },
  [Rule.OverAllowance]: { title: "Over the allowance", detail: "This would take the spender past their allowance for the period." },
  [Rule.UnknownService]: { title: "Unknown service", detail: "Nobody registered this service id, so there is no one to pay." },
  [Rule.ServiceSuspended]: { title: "Service suspended", detail: "The registry has suspended this service." },
  [Rule.InsufficientFunds]: { title: "Not enough in the account", detail: "The team account does not hold enough USDC." },
  [Rule.InvalidPolicy]: { title: "Invalid policy", detail: "Every limit must be above zero, the cap no larger than the allowance, and the end date in the future." },
  [Rule.UnknownRequest]: { title: "Unknown request", detail: "No approval request with that number." },
  [Rule.RequestNotPending]: { title: "Already decided", detail: "This request is no longer waiting for a decision." },
  [Rule.RequestNotApproved]: { title: "Not approved", detail: "Only an approved request can be settled." },
  [Rule.RequestExpired]: { title: "Request expired", detail: "Approval requests stay open for seven days." },
  [Rule.PayeeChanged]: { title: "Payee changed", detail: "The service moved its payout address after the request was filed, so the approval no longer applies." },
  [Rule.NotAuthorized]: { title: "Not allowed", detail: "Only the owner or the spender who filed it can settle a request." },
  [Rule.NoExceptionNeeded]: { title: "Within the rules", detail: "This payment fits the policy; pay it directly." },
  [Rule.NotEligibleForException]: { title: "Not eligible", detail: "Only limit rules can be overridden by an approval." },
  [Rule.AgentCannotRequest]: { title: "Agents cannot ask", detail: "An agent's refused payment stops there; it cannot file an approval request." },
  [Rule.RegistryUnavailable]: { title: "Registry unavailable", detail: "The service registry could not be read." },
  [Rule.NoPendingOwner]: { title: "No pending owner", detail: "No ownership transfer is in progress." },
};

export function ruleTitle(code: number): string {
  return COPY[code]?.title ?? `Contract error #${code}`;
}

export function ruleDetail(code: number): string {
  return COPY[code]?.detail ?? "The contract refused this call.";
}

/** Rules an owner can override by approving a one-off exception. */
export const EXCEPTION_ELIGIBLE: ReadonlySet<number> = new Set([
  Rule.ServiceNotAllowed,
  Rule.OverPaymentCap,
  Rule.OverFrequency,
  Rule.OverAllowance,
]);

export class ContractError extends Error {
  constructor(public readonly code: number) {
    super(ruleTitle(code));
    this.name = "ContractError";
  }
}
