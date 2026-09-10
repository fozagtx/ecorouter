export type Capability = "web.search";

export interface ProviderConfig {
  id: string;
  capability: Capability;
  endpoint: string;
  qualityScore: number;
}

export interface WebSearchInput { query: string }
export interface WebSearchResult {
  results: Array<{ title: string; url: string; snippet: string }>;
}

export interface PaymentChallenge {
  x402Version: number;
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  metadata?: unknown;
}

export interface MandateState {
  asset: string;
  maxPaymentAtomic: bigint;
  remainingAtomic: bigint;
  expiresAt: number;
  revoked: boolean;
}

export interface SignedPayment { payload: string; transactionHash?: string }
export interface SettlementReceipt { transactionHash: string }

export interface PaymentClient {
  loadMandate(account: string): Promise<MandateState>;
  authorizeAndSettle(args: {
    account: string;
    sessionSecret: string;
    executionId: string;
    providerId: string;
    challenge: PaymentChallenge;
  }): Promise<{ payment: SignedPayment; receipt: SettlementReceipt; remainingAtomic: bigint }>;
}

export interface EcoRouterConfig {
  account: string;
  sessionSecret: string;
  providers: ProviderConfig[];
  /** Stellar/x402 transport. Kept local; secrets are never sent to EcoRouter. */
  paymentClient: PaymentClient;
  fetch?: typeof globalThis.fetch;
}
export type ArbiterConfig = EcoRouterConfig;

export interface ExecuteRequest {
  executionId?: string;
  capability: Capability;
  input: WebSearchInput;
  policy: { maxSpendUsdc: string; minimumQuality: number };
}

export interface EcoRouterExecutionResult {
  executionId: string;
  output: WebSearchResult;
  decision: {
    providerId: string; priceUsdc: string; qualityScore: number;
    successRate: number; economicCost: number;
  };
  payment: { network: "stellar:testnet"; asset: "USDC"; transactionHash: string };
  mandate: { remainingUsdc: string };
}
export type ArbiterExecutionResult = EcoRouterExecutionResult;
