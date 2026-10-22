import { usd, type Micros } from "./money.js";
import type { Price, PriceQuote, StepInput, Usage } from "./types.js";

export interface PriceSource {
  /** Returns the current price for a provider, or null when this source has none. */
  quote(providerId: string): Promise<PriceQuote | null>;
}

/**
 * Prices you configure from each provider's pricing page.
 * EcoRouter ships no default numbers: a provider without a price is skipped, never guessed.
 */
export class StaticPrices implements PriceSource {
  private readonly at = Date.now();
  constructor(private readonly prices: Record<string, { price: Price; source: string }>) {}

  async quote(providerId: string): Promise<PriceQuote | null> {
    const entry = this.prices[providerId];
    return entry ? { ...entry, fetchedAt: this.at } : null;
  }
}

interface OpenRouterModel {
  id: string;
  pricing?: { prompt?: string; completion?: string; request?: string };
}

/**
 * Live per-token prices from OpenRouter's public model list.
 * Provider ids must look like "openrouter:<model id>", e.g. "openrouter:anthropic/claude-sonnet-4".
 */
export class OpenRouterPrices implements PriceSource {
  private cache: { at: number; models: Map<string, OpenRouterModel> } | null = null;

  constructor(
    private readonly opts: { ttlMs?: number; fetch?: typeof fetch; url?: string } = {},
  ) {}

  async quote(providerId: string): Promise<PriceQuote | null> {
    if (!providerId.startsWith("openrouter:")) return null;
    const models = await this.models();
    const model = models.get(providerId.slice("openrouter:".length));
    const prompt = Number(model?.pricing?.prompt);
    const completion = Number(model?.pricing?.completion);
    if (!model || !Number.isFinite(prompt) || !Number.isFinite(completion)) return null;
    return {
      price: { unit: "token", inputPerMTok: perMillion(prompt), outputPerMTok: perMillion(completion) },
      source: "openrouter.ai/api/v1/models",
      fetchedAt: this.cache!.at,
    };
  }

  private async models(): Promise<Map<string, OpenRouterModel>> {
    const ttl = this.opts.ttlMs ?? 60_000;
    if (this.cache && Date.now() - this.cache.at < ttl) return this.cache.models;
    const res = await (this.opts.fetch ?? fetch)(this.opts.url ?? "https://openrouter.ai/api/v1/models");
    if (!res.ok) throw new Error(`OpenRouter model list returned ${res.status}`);
    const body = (await res.json()) as { data?: OpenRouterModel[] };
    this.cache = { at: Date.now(), models: new Map((body.data ?? []).map((m) => [m.id, m])) };
    return this.cache.models;
  }
}

/** USD per token to USD per million tokens, without float noise like 0.09999999. */
function perMillion(perToken: number): number {
  return Math.round(perToken * 1e12) / 1e6;
}

/** Tries each source in order and returns the first price found. */
export class PriceBook implements PriceSource {
  constructor(private readonly sources: PriceSource[]) {}

  async quote(providerId: string): Promise<PriceQuote | null> {
    for (const source of this.sources) {
      const q = await source.quote(providerId);
      if (q) return q;
    }
    return null;
  }
}

const DEFAULT_OUTPUT_TOKENS = 1024;

/** Rough token count used only for the pre-call estimate: about 4 characters per token. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Upper-bound estimate used to check caps before calling. */
export function estimateCost(price: Price, input: StepInput): Micros {
  switch (price.unit) {
    case "token": {
      if (input.kind !== "reasoning") return 0;
      const inTok = approxTokens(input.prompt) + approxTokens(input.system ?? "");
      const outTok = input.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS;
      return usd((inTok * price.inputPerMTok + outTok * price.outputPerMTok) / 1e6);
    }
    case "request":
      return usd(price.usd);
    case "credit":
      return usd(price.usdPerCredit * price.creditsPerCall);
  }
}

/** Actual cost after the call: the provider's own number when it reports one, else usage times price. */
export function actualCost(price: Price, usage: Usage, estimate: Micros): { cost: Micros; source: "provider" | "price_sheet" } {
  if (usage.reportedCost !== undefined) return { cost: usage.reportedCost, source: "provider" };
  switch (price.unit) {
    case "token":
      if (usage.inputTokens === undefined || usage.outputTokens === undefined) return { cost: estimate, source: "price_sheet" };
      return {
        cost: usd((usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1e6),
        source: "price_sheet",
      };
    case "request":
      return { cost: usd(price.usd), source: "price_sheet" };
    case "credit":
      return { cost: usd(price.usdPerCredit * (usage.credits ?? price.creditsPerCall)), source: "price_sheet" };
  }
}
