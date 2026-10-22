#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { formatUsd, usd } from "./money.js";
import { OpenRouterPrices, PriceBook, StaticPrices } from "./prices.js";
import { anthropic, openaiCompatible, openrouter } from "./providers/models.js";
import { contextDev, exa, firecrawl, tavily } from "./providers/web.js";
import { RouteRefused, Router } from "./router.js";
import type { Price, Provider, StepInput } from "./types.js";

const USAGE = `ecorouter <ask|search|scrape> <text or url> [options]

  --cap <usd>         period cap for this agent (default 1)
  --step <usd>        per-step ceiling (default 0.05)
  --budget <usd>      budget for this run
  --latency <ms>      skip providers measured slower than this
  --frontier          reasoning: frontier models only
  --dry-run           show the routing decision, call nobody

Providers are enabled by their API key env vars: OPENROUTER_API_KEY, ANTHROPIC_API_KEY,
OPENAI_API_KEY, GROQ_API_KEY, EXA_API_KEY, TAVILY_API_KEY, FIRECRAWL_API_KEY, CONTEXT_DEV_API_KEY.
Model ids come from ECOROUTER_*_MODEL vars (see README).
Prices for non-OpenRouter providers come from the JSON file in ECOROUTER_PRICES.`;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function providersFromEnv(env = process.env): Provider[] {
  const out: Provider[] = [];
  if (env.OPENROUTER_API_KEY) {
    for (const model of (env.ECOROUTER_OPENROUTER_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      out.push(openrouter({ model, apiKey: env.OPENROUTER_API_KEY }));
    }
  }
  if (env.ANTHROPIC_API_KEY && env.ECOROUTER_ANTHROPIC_MODEL) {
    out.push(anthropic({ id: "anthropic", name: "Anthropic", model: env.ECOROUTER_ANTHROPIC_MODEL, apiKey: env.ANTHROPIC_API_KEY, frontier: true }));
  }
  if (env.OPENAI_API_KEY && env.ECOROUTER_OPENAI_MODEL) {
    out.push(openaiCompatible({ id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: env.ECOROUTER_OPENAI_MODEL, apiKey: env.OPENAI_API_KEY, frontier: true }));
  }
  if (env.GROQ_API_KEY && env.ECOROUTER_GROQ_MODEL) {
    out.push(openaiCompatible({ id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: env.ECOROUTER_GROQ_MODEL, apiKey: env.GROQ_API_KEY }));
  }
  if (env.EXA_API_KEY) out.push(exa({ apiKey: env.EXA_API_KEY }));
  if (env.TAVILY_API_KEY) out.push(tavily({ apiKey: env.TAVILY_API_KEY }));
  if (env.FIRECRAWL_API_KEY) out.push(firecrawl({ apiKey: env.FIRECRAWL_API_KEY }));
  if (env.CONTEXT_DEV_API_KEY) out.push(contextDev({ apiKey: env.CONTEXT_DEV_API_KEY }));
  return out;
}

function staticPrices(): StaticPrices {
  const file = process.env.ECOROUTER_PRICES;
  if (!file) return new StaticPrices({});
  return new StaticPrices(JSON.parse(readFileSync(file, "utf8")) as Record<string, { price: Price; source: string }>);
}

async function main(): Promise<number> {
  const [cmd, text] = process.argv.slice(2);
  const input: StepInput | null =
    cmd === "ask" && text ? { kind: "reasoning", prompt: text, frontier: process.argv.includes("--frontier") }
    : cmd === "search" && text ? { kind: "search", query: text }
    : cmd === "scrape" && text ? { kind: "scrape", url: text }
    : null;
  if (!input) {
    console.error(USAGE);
    return 2;
  }

  const providers = providersFromEnv();
  if (providers.length === 0) {
    console.error("No providers enabled. Set at least one provider API key.\n\n" + USAGE);
    return 2;
  }

  const router = new Router({ prices: new PriceBook([new OpenRouterPrices(), staticPrices()]), providers });
  router.caps.setPolicy({
    agentId: "cli",
    periodCap: usd(Number(arg("--cap") ?? 1)),
    period: "day",
    stepCeiling: usd(Number(arg("--step") ?? 0.05)),
    kinds: ["reasoning", "search", "scrape"],
    providers: [],
  });
  const budget = arg("--budget");
  if (budget) router.caps.openRun("cli-run", usd(Number(budget)));
  const opts = { runId: budget ? "cli-run" : undefined, latencyTargetMs: arg("--latency") ? Number(arg("--latency")) : undefined };

  const decision = await router.route("cli", input, opts);
  for (const c of decision.candidates) {
    const mark = c.providerId === decision.picked ? "→" : " ";
    console.log(`${mark} ${c.providerId.padEnd(46)} ${c.estimate === null ? "    n/a" : formatUsd(c.estimate, 5)}  ${c.skip ?? (mark === "→" ? "picked" : "fits")}`);
  }
  if (process.argv.includes("--dry-run") || decision.refusal) {
    if (decision.refusal) console.log(`\nrefused: ${decision.refusal}`);
    return decision.refusal ? 1 : 0;
  }

  try {
    const { output, receipt } = await router.run("cli", input, opts);
    console.log(`\n${output.text}\n`);
    console.log(`receipt: ${receipt.providerId} · ${formatUsd(receipt.cost, 5)} (${receipt.costSource}) · ${receipt.latencyMs}ms`);
    for (const a of receipt.attempts) console.log(`  rerouted from ${a.providerId}: ${a.error}`);
    return 0;
  } catch (err) {
    if (err instanceof RouteRefused) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

main().then((code) => process.exit(code), (err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
