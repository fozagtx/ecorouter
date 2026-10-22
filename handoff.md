# EcoRouter handoff

Last updated: 2026-10-22

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
| Airwallex (`packages/sdk/src/airwallex`) | Built against the documented API, tested offline. Auth, balances and funding check, virtual card per provider with limits mirroring the period cap, FX price conversion, signed webhook verification, reconciliation (a card decline reroutes). Not yet run against a live sandbox account. |
| CI (`.github/workflows/ci.yml`) | SDK typecheck, SDK tests, landing page build on every push and PR. |
| Stellar prototype | Removed: contracts, Rust workspace, testnet deployment, Stellar app and docs. |

## Todo

### Now
- [ ] **Apply to the hackathon before Oct 23** (Inference Sourcing track).
- [ ] Request Metal testnet access and find out what the track expects from Metal. [#14](https://github.com/fozagtx/ecorouter/issues/14)

### Integration
- [ ] Run the Airwallex flow on a live sandbox account: keys, Issuing enabled, cardholder `READY`, cards, simulated transactions, `Reconciler.drift()`. [#10](https://github.com/fozagtx/ecorouter/issues/10)
- [ ] Webhook endpoint that verifies `x-signature` and feeds `issuing.transaction.*` into the reconciler. [#11](https://github.com/fozagtx/ecorouter/issues/11)
- [ ] Run the router live with real provider keys and a price file; check receipts against provider billing. [#12](https://github.com/fozagtx/ecorouter/issues/12)

### Product
- [ ] Dashboard app: caps, runs, routing decisions, reroutes, card spend (the window on the landing page is an illustration).
- [ ] Persist the caps ledger, run budgets and card bindings (all in memory today; a restart resets spend).
- [ ] HTTP API or MCP server so agents in any language (or Claude Code) can call the router.
- [ ] Live prices beyond OpenRouter: today Exa, Tavily, Firecrawl, context.dev and direct model providers use a hand-filled price file.
- [ ] Documentation site for the SDK and Airwallex setup (old Stellar docs were removed; the README is the docs for now). [#13](https://github.com/fozagtx/ecorouter/issues/13)

### Engineering
- [ ] Reserve a safety margin or enforce max tokens so a long model answer cannot push spend past a cap (the pre-call estimate uses about 4 characters per token).
- [ ] Publish the SDK to npm as `ecorouter`.

### Submission
- [ ] Demo script: one agent run that routes, hits a cap, reroutes, and shows the Airwallex card spend.
- [ ] Record the walkthrough video (under 5 minutes).
- [ ] Setup instructions in the README for judges.
- [ ] Say in the submission that EcoRouter started as a Stellar spending-account project and was rebuilt for this track from Oct 22.

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
