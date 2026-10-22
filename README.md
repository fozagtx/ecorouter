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

## Airwallex

Settlement is planned on Airwallex and not wired yet: one funding wallet backing the caps, a virtual card per provider whose authorization controls mirror the agent's caps, FX on non-USD quotes, and card transaction webhooks reconciled into receipts. See [plans/airwallex-integration.md](plans/airwallex-integration.md).

## Repository

```text
.
├── packages/
│   ├── site/      # Landing page (Astro), includes the routing simulator
│   ├── docs/      # Documentation (Fumadocs), still describes the earlier Stellar prototype
│   ├── app/       # Earlier Stellar prototype app, to be replaced
│   └── sdk/       # Earlier Stellar agent SDK, to be replaced
├── contracts/     # Earlier Soroban contracts, to be removed
├── plans/         # Integration plans
└── docs/          # Built static site
```

The landing page and positioning have moved off Stellar. The `app`, `sdk`, `contracts` and docs content are from the earlier Stellar spending-account prototype and will be replaced by the router core and Airwallex integration.

## Run the landing page

```bash
pnpm install
pnpm dev:site
```

## Status

Hackathon build. Not audited. Prices shown on the landing page are example quotes, not live data.

## License

Apache License 2.0. See [LICENSE](LICENSE).
