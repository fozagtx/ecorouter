# Airwallex integration plan

Status: planned. Nothing here is wired yet. Track: Airwallex Agentic Banking Hackathon, Kit 12 "Inference Sourcing" (source each AI step by live price, reroute when budgets or speed change). Track setup: Metal testnet access.

## What EcoRouter does

EcoRouter is a unified resource router for agentic inference. An agent asks for a step (`reasoning`, `search`, `scrape`, `context`, `rerank`). The router quotes every provider allowed for that agent, keeps the ones that are healthy, under the latency target and inside the remaining cap, and calls the cheapest. Each step is routed fresh, so a price change, a slow provider or a shrinking budget reroutes the next step.

Airwallex is the money side: the caps the router enforces should be backed by real funds and enforced a second time at the card.

## Pieces

| # | Piece | Airwallex surface | Router side |
|---|-------|-------------------|-------------|
| 1 | Funding wallet | Balances | Sum of active agent period caps must not exceed available balance. Refuse to raise a cap past it. |
| 2 | Virtual card per (agent, provider) | Issuing: `POST /api/v1/issuing/cards/create` with `authorization_controls` (`per_transaction_limits`, `allowed_merchant_categories`) | Card limit mirrors the agent's per-step ceiling. Provider billing uses that card. |
| 3 | FX on quotes | FX rates and conversions | Convert non-USD provider prices at the live rate before comparing against the cap. |
| 4 | Reconciliation | Issuing transactions + webhooks | Match card transactions to router receipts. Replace the quoted cost with the actual cost. A decline marks the provider unhealthy and reroutes. |
| 5 | Agent-initiated top-ups (stretch) | Payouts / transfers | When a prepaid provider balance runs low and the cap allows it, top it up. |

## Order of work

1. Router core in TypeScript: quote table, cap ledger, `route(agent, step, budget, latency)` with the same check order shown on the landing page. Pure functions and tests, no network.
2. Provider adapters for a first set: Anthropic, OpenAI, Groq (reasoning), Exa, Tavily (search), Firecrawl, context.dev (scrape and context). Measure latency per call; price from published sheets with a freshness window.
3. Airwallex sandbox (`api-demo.airwallex.com`): auth, read balance, create one card per provider with authorization controls.
4. Webhook receiver for issuing transactions, reconciliation into receipts.
5. FX conversion for providers billing outside USD.
6. Dashboard: caps, runs, per-step routing decisions, card spend.

## Open questions

- Which Metal testnet resources the Inference Sourcing kit expects, and whether settlement should also be mirrored there.
- Whether providers can be billed per card or only via prepaid credit balances (affects piece 2 vs piece 5).
- Webhook event names and payloads to confirm against the sandbox before building piece 4.
