# ecorouter

Route each agent step to the cheapest provider that fits its spending cap, and settle provider spend on Airwallex.

```ts
import { Router, PriceBook, OpenRouterPrices, StaticPrices, openrouter, exa, tavily, firecrawl, contextDev, usd } from "ecorouter";

const router = new Router({
  prices: new PriceBook([
    new OpenRouterPrices(),                      // live per-token prices
    new StaticPrices({                           // example values: copy yours from each pricing page
      exa: { price: { unit: "request", usd: 0.005 }, source: "exa.ai/pricing" },
      contextdev: { price: { unit: "credit", usdPerCredit: 0.0022, creditsPerCall: 1 }, source: "context.dev/pricing" },
    }),
  ]),
  providers: [
    openrouter({ model: "meta-llama/llama-3.3-70b-instruct", apiKey: process.env.OPENROUTER_API_KEY }),
    exa({ apiKey: process.env.EXA_API_KEY }),
    contextDev({ apiKey: process.env.CONTEXT_DEV_API_KEY }),
  ],
});

router.caps.setPolicy({
  agentId: "research",
  periodCap: usd(50), period: "day",
  stepCeiling: usd(0.4),
  kinds: ["reasoning", "search", "scrape"],
  providers: [],                                 // empty = any registered provider
});
router.caps.openRun("run-1", usd(0.05));

const { output, receipt } = await router.run("research", { kind: "search", query: "Airwallex Issuing API" }, { runId: "run-1", latencyTargetMs: 2000 });
```

## How a step is routed

Checks run in this order; a provider that fails one is skipped with that reason:

1. agent known, not paused, step kind allowed
2. provider on the agent's allowlist, frontier model if asked, healthy (circuit breaker)
3. priced (no price means skipped, never guessed)
4. estimate within the per-step ceiling, the run budget and the period cap
5. measured latency under the target

The cheapest remaining provider wins; ties go to the faster one. `router.route()` returns the decision without calling anyone. `router.run()` reserves the estimate, calls, reroutes to the next provider on error or timeout, and settles the real cost (the provider's own reported cost when it returns one).

## Providers

| Kind | Adapter | Notes |
|------|---------|-------|
| reasoning | `openrouter({ model })` | live prices via `OpenRouterPrices`; reports actual cost |
| reasoning | `anthropic({ id, model })` | Messages API |
| reasoning | `openaiCompatible({ id, baseUrl, model })` | OpenAI, Groq, Mistral, DeepSeek, Together, Fireworks |
| search | `exa()`, `tavily()` | Exa reports `costDollars` |
| scrape | `firecrawl()`, `contextDev()` | settle on credits used |

## Airwallex

```ts
import { AirwallexClient, ProviderCards, Reconciler, checkFunding, verifyWebhook, issuingTransaction } from "ecorouter";

const airwallex = new AirwallexClient({ clientId, apiKey, env: "sandbox" });
await checkFunding(airwallex, [policy]);                       // caps must fit the wallet
const cards = new ProviderCards(airwallex, { cardholderId, createdBy: "Team Owner" });
await cards.ensure(policy, "exa");                             // virtual card, limits = period cap

const reconciler = new Reconciler(cards, router.health);       // pass reconciler.receipt as Router onReceipt
// webhook handler:
const event = verifyWebhook(rawBody, headers, webhookSecret);
const tx = issuingTransaction(event);
if (tx) reconciler.transaction(tx);                            // a decline reroutes the next step
```

`AirwallexFxPrices` converts provider prices quoted in other currencies to USD at the live Airwallex rate.

## CLI

```bash
OPENROUTER_API_KEY=... ECOROUTER_OPENROUTER_MODELS="openai/gpt-4o-mini,meta-llama/llama-3.3-70b-instruct" \
  npx ecorouter ask "Summarise this" --budget 0.01 --dry-run
```

Set `ECOROUTER_PRICES` to a JSON file of static prices for non-OpenRouter providers. Run `npx ecorouter` for all options.

## Status

Hackathon build, not audited. Tests run offline (`pnpm test`). The Airwallex client is written against the documented API and not yet run against a live sandbox account.
