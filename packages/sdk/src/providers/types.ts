import type { PaymentChallenge, SignedPayment, WebSearchInput, WebSearchResult } from "../types.js";
export interface WebSearchProviderAdapter {
  id: string; endpoint: string; qualityScore: number;
  challenge(input: WebSearchInput): Promise<PaymentChallenge>;
  execute(input: WebSearchInput, payment: SignedPayment): Promise<unknown>;
  normalize(response: unknown): WebSearchResult;
}
