import { InvalidPaymentChallengeError, ProviderResponseError } from "../errors.js";
import type { PaymentChallenge, ProviderConfig, SignedPayment, WebSearchInput, WebSearchResult } from "../types.js";
import type { WebSearchProviderAdapter } from "./types.js";

export class HttpWebSearchProvider implements WebSearchProviderAdapter {
  readonly id; readonly endpoint; readonly qualityScore;
  constructor(config: ProviderConfig, private readonly request: typeof fetch) {
    this.id = config.id; this.endpoint = config.endpoint; this.qualityScore = config.qualityScore;
  }
  async challenge(input: WebSearchInput): Promise<PaymentChallenge> {
    const response = await this.request(this.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (response.status !== 402) throw new InvalidPaymentChallengeError(`${this.id} did not return HTTP 402`);
    const encoded = response.headers.get("payment-required");
    if (!encoded) throw new InvalidPaymentChallengeError(`${this.id} omitted payment-required`);
    try { return JSON.parse(BufferFromBase64(encoded)) as PaymentChallenge; }
    catch { throw new InvalidPaymentChallengeError(`${this.id} returned malformed payment-required`); }
  }
  async execute(input: WebSearchInput, payment: SignedPayment): Promise<unknown> {
    const response = await this.request(this.endpoint, { method: "POST", headers: { "content-type": "application/json", "payment-signature": payment.payload }, body: JSON.stringify(input) });
    if (!response.ok) throw new Error(`provider returned ${response.status}`);
    return response.json();
  }
  normalize(response: unknown): WebSearchResult {
    if (!response || typeof response !== "object" || !Array.isArray((response as { results?: unknown }).results)) throw new ProviderResponseError();
    const results = (response as { results: unknown[] }).results.map((item) => {
      if (!item || typeof item !== "object") throw new ProviderResponseError();
      const { title, url, snippet } = item as Record<string, unknown>;
      if (typeof title !== "string" || typeof url !== "string" || typeof snippet !== "string") throw new ProviderResponseError();
      return { title, url, snippet };
    });
    return { results };
  }
}
function BufferFromBase64(value: string): string {
  if (typeof globalThis.atob === "function") return globalThis.atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  throw new Error("base64 decoding is unavailable");
}
