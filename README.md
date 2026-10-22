# EcoRouter

> A unified resource router for agentic inference, based on spending caps.

Built for the [Airwallex Agentic Banking Hackathon](https://airwallex.hackerearth.com/), Inference Sourcing track: source each AI step by live price, reroute when budgets or speed change.

Agents ask for a capability, not a vendor: a model call, a web search, a scrape, a company lookup, a rerank. EcoRouter quotes every provider the agent is allowed to use, keeps the ones that are healthy, under the latency target and inside the remaining cap, and calls the cheapest. Each step is routed fresh, so when a price moves, a provider slows down or the budget runs low, the next step goes somewhere else. When nothing fits, the step stops before anything is spent.

Providers on the routing table include OpenAI, Anthropic, Groq, Mistral, Google Gemini, DeepSeek, OpenRouter, Together AI, Fireworks AI (models), Exa, Tavily, Perplexity (search), Firecrawl and context.dev (scrape and context), and Cohere (rerank).

## Checks before every provider call

```
route(agent, step, budget, latency)

 1  agent active
 2  step kind allowed for this agent
 3  provider on the agent's allowlist
 4  quote <= per-step ceiling
 5  quote <= budget left on the run
 6  quote <= period cap left
 7  quote fresh (refetch if stale)
 8  measured latency <= target
 9  provider healthy (recent errors/timeouts take it out)
10  call, meter actual cost, write receipt
```

The first failed check stops the step. Among providers that pass, the cheapest wins; ties go to the faster one.

## SDK

`packages/sdk` (`ecorouter` on npm once published) is the router: caps ledger, live OpenRouter prices, provider adapters (OpenRouter, Anthropic, OpenAI-compatible, Exa, Tavily, Firecrawl, context.dev), reroute on failure, receipts. See [packages/sdk/README.md](packages/sdk/README.md).

```bash
pnpm test     # 26 offline tests
```

## Airwallex

Built into the SDK: funding check against the wallet balance, one virtual card per provider whose limits mirror the agent's period cap, FX on non-USD quotes, and signed `issuing.transaction.*` webhooks reconciled into receipts (a card decline reroutes the next step). Tested offline against the documented API; not yet run against a live sandbox account. See [plans/airwallex-integration.md](plans/airwallex-integration.md).

## Repository

```text
.
├── packages/
│   ├── sdk/       # Router SDK + Airwallex settlement (npm name: ecorouter)
│   └── site/      # Landing page (Astro), includes the routing simulator
├── plans/         # Integration plans
├── handoff.md     # Current state and todo list
└── docs/          # Built static site, deployed to GitHub Pages
```

## Run the landing page

```bash
pnpm install
pnpm dev:site
```

## Status

Hackathon build. Not audited. Prices shown on the landing page are example quotes, not live data.

## License

Apache License 2.0. See [LICENSE](LICENSE).
