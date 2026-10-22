import type { Micros } from "./money.js";

/** What an agent asks for. Agents name a capability, never a vendor. */
export type StepKind = "reasoning" | "search" | "scrape";

export interface ReasoningInput {
  kind: "reasoning";
  prompt: string;
  system?: string;
  maxOutputTokens?: number;
  /** Only route to providers tagged as frontier models. */
  frontier?: boolean;
}

export interface SearchInput {
  kind: "search";
  query: string;
  maxResults?: number;
}

export interface ScrapeInput {
  kind: "scrape";
  url: string;
}

export type StepInput = ReasoningInput | SearchInput | ScrapeInput;

/** How a provider charges. Converted to micro-dollars by `estimateCost`. */
export type Price =
  | { unit: "token"; inputPerMTok: number; outputPerMTok: number }
  | { unit: "request"; usd: number }
  | { unit: "credit"; usdPerCredit: number; creditsPerCall: number };

export interface PriceQuote {
  price: Price;
  /** Where the number came from, so every routing decision can be audited. */
  source: string;
  fetchedAt: number;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  credits?: number;
  /** Cost reported by the provider itself, when its API returns one. */
  reportedCost?: Micros;
}

export interface StepOutput {
  text: string;
  results?: Array<{ title?: string; url: string; snippet?: string }>;
  raw?: unknown;
}

export interface CallResult {
  output: StepOutput;
  usage: Usage;
}

export interface Provider {
  /** Unique id, e.g. "anthropic:claude-sonnet" or "exa". */
  id: string;
  name: string;
  kinds: StepKind[];
  frontier?: boolean;
  call(input: StepInput, signal: AbortSignal): Promise<CallResult>;
}

export type Period = "day" | "week" | "month";

export interface AgentPolicy {
  agentId: string;
  /** Spend allowed per period, in micro-dollars. */
  periodCap: Micros;
  period: Period;
  /** Most any single step may cost. */
  stepCeiling: Micros;
  kinds: StepKind[];
  /** Provider ids this agent may use. Empty means every registered provider. */
  providers: string[];
  paused?: boolean;
}

export type RefusalReason =
  | "agent_unknown"
  | "agent_paused"
  | "kind_not_allowed"
  | "no_providers"
  | "nothing_fits";

export type SkipReason =
  | "not_allowed"
  | "not_frontier"
  | "unhealthy"
  | "no_price"
  | "over_step_ceiling"
  | "over_run_budget"
  | "over_period_cap"
  | "too_slow";

export interface Candidate {
  providerId: string;
  estimate: Micros | null;
  latencyMs: number | null;
  priceSource: string | null;
  skip: SkipReason | null;
}

export interface RouteDecision {
  agentId: string;
  kind: StepKind;
  picked: string | null;
  candidates: Candidate[];
  runLeft: Micros | null;
  periodLeft: Micros;
  refusal: RefusalReason | null;
}

export interface Receipt {
  id: string;
  agentId: string;
  runId?: string;
  kind: StepKind;
  providerId: string;
  estimate: Micros;
  cost: Micros;
  costSource: "provider" | "price_sheet";
  latencyMs: number;
  attempts: Array<{ providerId: string; error: string }>;
  at: number;
}
