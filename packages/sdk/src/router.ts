import { randomUUID } from "node:crypto";
import { CapLedger } from "./caps.js";
import { HealthTracker } from "./health.js";
import type { Micros } from "./money.js";
import { actualCost, estimateCost, type PriceSource } from "./prices.js";
import type {
  Candidate,
  PriceQuote,
  Provider,
  Receipt,
  RouteDecision,
  StepInput,
  StepOutput,
} from "./types.js";

export interface RouteOptions {
  runId?: string;
  /** Skip providers whose measured latency is above this. Unmeasured providers are allowed. */
  latencyTargetMs?: number;
  /** Abort a provider call after this long and reroute. Default 60s. */
  timeoutMs?: number;
}

export interface RunResult {
  output: StepOutput;
  receipt: Receipt;
  decision: RouteDecision;
}

export class RouteRefused extends Error {
  constructor(
    readonly decision: RouteDecision,
    readonly attempts: Receipt["attempts"] = [],
  ) {
    super(
      decision.refusal === "nothing_fits" && attempts.length
        ? `every fitting provider failed: ${attempts.map((a) => `${a.providerId} (${a.error})`).join(", ")}`
        : `step refused: ${decision.refusal}`,
    );
    this.name = "RouteRefused";
  }
}

export interface RouterConfig {
  prices: PriceSource;
  caps?: CapLedger;
  health?: HealthTracker;
  providers?: Provider[];
  /** Called after every settled step, e.g. to reconcile against card spend. */
  onReceipt?: (receipt: Receipt) => void | Promise<void>;
}

interface Fit {
  provider: Provider;
  quote: PriceQuote;
  estimate: Micros;
  latencyMs: number | null;
}

export class Router {
  readonly caps: CapLedger;
  readonly health: HealthTracker;
  private readonly providers = new Map<string, Provider>();
  private readonly prices: PriceSource;
  private readonly onReceipt?: RouterConfig["onReceipt"];

  constructor(config: RouterConfig) {
    this.prices = config.prices;
    this.caps = config.caps ?? new CapLedger();
    this.health = config.health ?? new HealthTracker();
    this.onReceipt = config.onReceipt;
    for (const p of config.providers ?? []) this.register(p);
  }

  register(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Decide where a step would go without calling anyone.
   * Checks, in order: agent known, not paused, kind allowed, provider allowed, frontier,
   * healthy, priced, per-step ceiling, run budget, period cap, latency target.
   */
  async route(agentId: string, input: StepInput, opts: RouteOptions = {}): Promise<RouteDecision> {
    const { decision } = await this.evaluate(agentId, input, opts);
    return decision;
  }

  /** Route, call the cheapest fitting provider, reroute on failure, and settle the real cost. */
  async run(agentId: string, input: StepInput, opts: RouteOptions = {}): Promise<RunResult> {
    const { decision, fits } = await this.evaluate(agentId, input, opts);
    if (decision.refusal) throw new RouteRefused(decision);

    const attempts: Receipt["attempts"] = [];
    for (const fit of fits) {
      const hold = this.caps.reserve(agentId, fit.estimate, opts.runId);
      if (!hold) {
        attempts.push({ providerId: fit.provider.id, error: "cap taken by a concurrent step" });
        continue;
      }
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
      try {
        const result = await fit.provider.call(input, controller.signal);
        const latencyMs = Date.now() - started;
        this.health.success(fit.provider.id, latencyMs);
        const { cost, source } = actualCost(fit.quote.price, result.usage, fit.estimate);
        this.caps.settle(hold, cost);
        const receipt: Receipt = {
          id: randomUUID(),
          agentId,
          runId: opts.runId,
          kind: input.kind,
          providerId: fit.provider.id,
          estimate: fit.estimate,
          cost,
          costSource: source,
          latencyMs,
          attempts,
          at: Date.now(),
        };
        await this.onReceipt?.(receipt);
        return { output: result.output, receipt, decision: { ...decision, picked: fit.provider.id } };
      } catch (err) {
        this.caps.release(hold);
        this.health.failure(fit.provider.id);
        attempts.push({ providerId: fit.provider.id, error: controller.signal.aborted ? "timeout" : errorText(err) });
      } finally {
        clearTimeout(timer);
      }
    }
    throw new RouteRefused({ ...decision, picked: null, refusal: "nothing_fits" }, attempts);
  }

  private async evaluate(agentId: string, input: StepInput, opts: RouteOptions) {
    const policy = this.caps.policy(agentId);
    const runLeft = opts.runId !== undefined ? this.caps.runLeft(opts.runId) : null;
    const periodLeft = this.caps.periodLeft(agentId);
    const base = { agentId, kind: input.kind, picked: null, candidates: [] as Candidate[], runLeft, periodLeft };

    if (!policy) return { decision: { ...base, refusal: "agent_unknown" as const }, fits: [] };
    if (policy.paused) return { decision: { ...base, refusal: "agent_paused" as const }, fits: [] };
    if (!policy.kinds.includes(input.kind)) return { decision: { ...base, refusal: "kind_not_allowed" as const }, fits: [] };

    const pool = [...this.providers.values()].filter((p) => p.kinds.includes(input.kind));
    if (pool.length === 0) return { decision: { ...base, refusal: "no_providers" as const }, fits: [] };

    const wantsFrontier = input.kind === "reasoning" && input.frontier === true;
    const candidates: Candidate[] = [];
    const fits: Fit[] = [];

    for (const provider of pool) {
      const latencyMs = this.health.latency(provider.id);
      const c: Candidate = { providerId: provider.id, estimate: null, latencyMs, priceSource: null, skip: null };
      candidates.push(c);

      if (policy.providers.length > 0 && !policy.providers.includes(provider.id)) { c.skip = "not_allowed"; continue; }
      if (wantsFrontier && !provider.frontier) { c.skip = "not_frontier"; continue; }
      if (!this.health.healthy(provider.id)) { c.skip = "unhealthy"; continue; }

      let quote: PriceQuote | null = null;
      try {
        quote = await this.prices.quote(provider.id);
      } catch {
        quote = null;
      }
      if (!quote) { c.skip = "no_price"; continue; }
      const estimate = estimateCost(quote.price, input);
      c.estimate = estimate;
      c.priceSource = quote.source;

      if (estimate > policy.stepCeiling) { c.skip = "over_step_ceiling"; continue; }
      if (runLeft !== null && estimate > runLeft) { c.skip = "over_run_budget"; continue; }
      if (estimate > periodLeft) { c.skip = "over_period_cap"; continue; }
      if (opts.latencyTargetMs !== undefined && latencyMs !== null && latencyMs > opts.latencyTargetMs) { c.skip = "too_slow"; continue; }

      fits.push({ provider, quote, estimate, latencyMs });
    }

    // Cheapest first; ties go to the faster provider (unmeasured counts as slowest).
    fits.sort((a, b) => a.estimate - b.estimate || (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity));
    const picked = fits[0]?.provider.id ?? null;
    return {
      decision: { ...base, candidates, picked, refusal: picked ? null : ("nothing_fits" as const) },
      fits,
    };
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
