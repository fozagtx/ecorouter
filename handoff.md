# EcoRouter handoff

Last updated: 2026-10-22 (after reading the Kit 12 builder guide)

## What EcoRouter is

A unified resource router for agentic inference, based on spending caps. Agents ask for a step (reasoning, search, scrape). EcoRouter quotes every allowed provider, skips the ones over the step ceiling, run budget, period cap or latency target, calls the cheapest, reroutes on failure, and settles the real cost. Settlement is built on Airwallex: a funding wallet backs the caps and each provider is paid with its own virtual card.

Built for the Airwallex Agentic Banking Hackathon, Kit 12 "Inference Sourcing" (source each AI step by live price, reroute when budgets or speed change).

## Hackathon dates

| Date | What |
|------|------|
| Oct 23 | Applications close |
| Oct 25 | Accepted teams notified, build period starts |
| Nov 13 | Submissions due: working demo, video under 5 minutes, repo with setup instructions |
| Nov 15 | Finalists selected |
| Nov 19 | Demo day, San Francisco (remote optional) |

## Current state

| Area | State |
|------|-------|
| Landing page (`packages/site`) | Done. Cube-style layout in EcoRouter colors, routing simulator, live at ecorouter.xyz. Prices on the page are labelled examples. |
| Router SDK (`packages/sdk`) | Done and tested offline (26 tests). Caps ledger, live OpenRouter prices, health and circuit breaker, reroute on failure, receipts. Adapters: OpenRouter, Anthropic, OpenAI-compatible (OpenAI, Groq, Mistral, DeepSeek, Together, Fireworks), Exa, Tavily, Firecrawl, context.dev. CLI: `npx ecorouter`. |
| Airwallex (`packages/sdk/src/airwallex`) | Issuing side built and tested offline (virtual card per provider, funding check, FX, signed webhooks, reconciliation). Kit 12 needs Payments card holds instead; that client is being added. Auth and FX carry over. |
| CI (`.github/workflows/ci.yml`) | SDK typecheck, SDK tests, landing page build on every push and PR. |
| Stellar prototype | Removed: contracts, Rust workspace, testnet deployment, Stellar app and docs. |

## Todo

Kit 12 (from the builder guide at airwallexdev.com/guide) is built differently from what we first made: customers approve an Airwallex **card hold** per job, providers are **our own x402 endpoints paid per step through Metal testnet clearing**, and the price is read from each provider's 402 offer on every request. The router core carries over; the money side is being rebuilt to match. Numbered items match the gap list.

### Now
- [ ] 14. **Apply to the hackathon before Oct 23** (Inference Sourcing track).

### Kit 12 build (in progress)
- [ ] 1. Metal testnet: account, funded key, USDZ from the faucet, RPC endpoint, `@metalntwx/metal-pay` wired in. Guides: docs.metalntwx.com/agents. [#14](https://github.com/fozagtx/ecorouter/issues/14)
- [ ] 2. Our own x402 providers: at least three, different prices and speeds, answers in chunks from a real model or stand-in text (`ClearingDebitServerScheme`).
- [ ] 3. Pay per step through clearing: `depositToClearing` per job, `ClearingDebitScheme` per request (signs a running total, one payment at a time per key), facilitator `POST /clearing/position`, `withdrawFromClearing` (waits for the epoch).
- [ ] 4. Customer card hold on Airwallex Payments: `POST /pa/payment_intents/create`, `/confirm` with test card `4035501000000008` and `authorization_type: 'pre_auth'`, `auto_capture: false`, then `/increment_authorization`, `/capture` (once, never above the hold), `/cancel`.
- [ ] 5. Price from the provider's 402 offer on every request (no cached prices).
- [ ] 6. Jobs and a float: per-job budget backed by its hold, one shared USDZ float set below the budgets combined, a float floor in code.
- [ ] 7. Float rationing: when a job overruns (4x tokens) and the cheapest provider slows, decide which jobs reroute, which get the remaining float, and which customer is asked to raise their hold.

### What judges look for (guide: "Build around a financial decision")
- [ ] 8. Model in the loop: rules, budgets and price lists stay in code; the model judges which answers are worth the more expensive provider and explains exceptions, through typed tools only.
- [ ] 9. Approval step: asking a customer to raise their hold is a human approval bound to the exact amount, currency and job.
- [ ] 10. Put sandbox simulation calls behind one interface so they can be swapped without touching decision logic.
- [ ] 11. Demo run end to end: goal, plan, new information (overrun + slow provider), revised decision, then holds captured, rest released, unused deposits withdrawn.
- [ ] 12. Dashboard to show it: jobs, holds, float, per-step provider and price, reroutes, captures.

### Submission (due Nov 13)
- [ ] 13. Working demo, video under 5 minutes, setup instructions in the README for judges.

### Earlier work to revisit
- [ ] Airwallex Issuing code (virtual card per provider) does not fit Kit 12. Remove it or keep as an extra. Issues [#10](https://github.com/fozagtx/ecorouter/issues/10) and [#11](https://github.com/fozagtx/ecorouter/issues/11) change with this.
- [ ] Run the router live with real third-party provider keys. [#12](https://github.com/fozagtx/ecorouter/issues/12)
- [ ] Persist ledgers (all in memory today; a restart resets spend).
- [ ] Reserve a safety margin or enforce max tokens so a long answer cannot push spend past a budget.
- [ ] HTTP API or MCP server so agents in any language can call the router.
- [ ] Documentation for the SDK and setup. [#13](https://github.com/fozagtx/ecorouter/issues/13)
- [ ] Publish the SDK to npm as `ecorouter`.

### Useful setup from the guide
- Airwallex MCP servers for Claude Code: `claude mcp add-json airwallex-docs '{ "type": "http", "url": "https://mcp.sandbox.airwallex.com/docs" }'` and `airwallex-dev` at `https://mcp.sandbox.airwallex.com/developer`.
- Sandbox signup at sandbox.airwallex.com; keys under Account > Developer > API keys. Business names "New Business Sandbox" or "Sandbox Business" are auto-approved.
- Fund the sandbox: `GET /global_accounts`, create one only if empty, then `POST /simulation/deposit/create`.
- Sandbox rate limit: 20 req/s global, 10 per endpoint, 10 concurrent.
- USDZ amounts are base units with 18 decimals; Airwallex amounts are major units.

## How to run

```bash
pnpm install
pnpm test                 # SDK tests, offline
pnpm dev:site             # landing page
OPENROUTER_API_KEY=... ECOROUTER_OPENROUTER_MODELS="openai/gpt-4o-mini,meta-llama/llama-3.3-70b-instruct" \
  pnpm router ask "hello" --dry-run
```

## Key files

- `packages/sdk/src/router.ts`: routing order, reroute, settle
- `packages/sdk/src/caps.ts`: reserve, settle, release against run and period caps
- `packages/sdk/src/prices.ts`: price sources (OpenRouter live, static file) and cost estimates
- `packages/sdk/src/airwallex/`: client, webhook verification, cards, reconciliation, FX
- `plans/airwallex-integration.md`: verified Airwallex endpoints and the sandbox run steps
- `packages/site/src/components/`: landing page sections

## Notes

- Airwallex sandbox host is `https://api.sandbox.airwallex.com`. Amounts are decimal major units. Card limits use `authorization_controls.transaction_limits.limits[]`.
- Card limits mirror the period cap, not the per-step ceiling, because providers bill per invoice or top-up, not per API call.
- The live site deploys from the committed `docs/` folder. Run `pnpm build:site` and commit `docs/` to publish changes.
- Commits carry only the repo owner as author. No co-author lines.
