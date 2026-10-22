import { usd, type Micros } from "ecorouter";

/** What a job step needs. */
export type StepKind = "reasoning" | "search" | "lookup";

export interface StepRequest {
  kind: StepKind;
  prompt: string;
  /** Tokens the step may generate (reasoning only). */
  maxTokens?: number;
}

/**
 * One provider we run. Prices are ours to set: these are the operator's own x402 endpoints,
 * and the price a caller pays is whatever the next 402 offer says.
 */
export interface ProviderSpec {
  id: string;
  name: string;
  kind: StepKind;
  tier: "premium" | "standard" | "budget";
  /** Reasoning: USD per 1,000 tokens (prompt + output). Search/lookup: USD per call. */
  usdPerUnit: number;
  /** Time to first chunk under normal load. */
  baseLatencyMs: number;
  /** Output speed for reasoning, tokens per second. */
  tokensPerSecond?: number;
}

/** Live conditions a provider can change at any time. */
export interface ProviderState {
  /** Multiplies latency, e.g. 6 when the provider is under load. */
  slowFactor: number;
  /** Multiplies price, e.g. 1.5 after a price rise. */
  priceFactor: number;
  down: boolean;
}

export const DEFAULT_STATE: ProviderState = { slowFactor: 1, priceFactor: 1, down: false };

/** The demo catalog: three model providers, two search providers, one data lookup. */
export const CATALOG: ProviderSpec[] = [
  { id: "apex", name: "Apex", kind: "reasoning", tier: "premium", usdPerUnit: 0.12, baseLatencyMs: 900, tokensPerSecond: 150 },
  { id: "atlas", name: "Atlas", kind: "reasoning", tier: "standard", usdPerUnit: 0.04, baseLatencyMs: 700, tokensPerSecond: 260 },
  { id: "swift", name: "Swift", kind: "reasoning", tier: "budget", usdPerUnit: 0.015, baseLatencyMs: 250, tokensPerSecond: 600 },
  { id: "beacon", name: "Beacon", kind: "search", tier: "standard", usdPerUnit: 0.04, baseLatencyMs: 500 },
  { id: "scout", name: "Scout", kind: "search", tier: "budget", usdPerUnit: 0.025, baseLatencyMs: 650 },
  { id: "ledgerline", name: "Ledgerline", kind: "lookup", tier: "standard", usdPerUnit: 0.03, baseLatencyMs: 300 },
];

export function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Units the request is priced on: tokens for reasoning, calls otherwise. */
export function units(spec: ProviderSpec, req: StepRequest): number {
  if (spec.kind !== "reasoning") return 1;
  return (approxTokens(req.prompt) + (req.maxTokens ?? 512)) / 1000;
}

/** Price of one request in micro-dollars, rounded up to a whole clearing unit (1e-6 USDZ). */
export function quote(spec: ProviderSpec, state: ProviderState, req: StepRequest): Micros {
  return Math.max(1, Math.ceil(usd(spec.usdPerUnit * units(spec, req) * state.priceFactor)));
}

/** How long the provider takes to answer this request. */
export function latencyMs(spec: ProviderSpec, state: ProviderState, req: StepRequest): number {
  const generate = spec.kind === "reasoning" ? ((req.maxTokens ?? 512) / (spec.tokensPerSecond ?? 100)) * 1000 : 0;
  return Math.round((spec.baseLatencyMs + generate) * state.slowFactor);
}

const WORDS =
  "revenue margin pricing market customers growth churn contract renewal enterprise segment competitor supplier forecast risk cash runway hiring product roadmap region expansion".split(" ");

/**
 * Stand-in answer text, deterministic per provider and prompt, split into chunks.
 * The guide allows a real model or stand-in text; stand-in keeps the demo free and repeatable.
 */
export function standInAnswer(spec: ProviderSpec, req: StepRequest): string[] {
  let seed = 0;
  for (const ch of spec.id + req.prompt) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const next = () => (seed = (seed * 1103515245 + 12345) >>> 0);
  const tokens = spec.kind === "reasoning" ? Math.min(req.maxTokens ?? 512, 400) : 60;
  const chunks: string[] = [];
  let sentence: string[] = [];
  for (let i = 0; i < tokens; i++) {
    sentence.push(WORDS[next() % WORDS.length]);
    if (sentence.length === 12) {
      chunks.push(`${sentence.join(" ")}. `);
      sentence = [];
    }
  }
  if (sentence.length) chunks.push(`${sentence.join(" ")}.`);
  return [`[${spec.name} · ${spec.kind}] `, ...chunks];
}
