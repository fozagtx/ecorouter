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
| Kit 12 agent (`packages/kit12`) | Built and **run live on Metal testnet**: three x402 providers per kind (Apex/Atlas/Swift models, Beacon/Scout search, Ledgerline lookup) priced per request from their 402 offer, one clearing wallet and deposit per job, card holds per job, shared float with a floor, rationing, overrun approvals, a Claude judge with rule fallback. Simulator rail and simulated holds behind the same interfaces. 8 offline tests. |
| CI (`.github/workflows/ci.yml`) | SDK typecheck and tests, Kit 12 typecheck and tests, landing page build on every push and PR. |
| Stellar prototype | Removed: contracts, Rust workspace, testnet deployment, Stellar app and docs. |

## Todo

Kit 12 (from the builder guide at airwallexdev.com/guide) is built differently from what we first made: customers approve an Airwallex **card hold** per job, providers are **our own x402 endpoints paid per step through Metal testnet clearing**, and the price is read from each provider's 402 offer on every request. The router core carries over; the money side is being rebuilt to match. Numbered items match the gap list.

### Now
- [ ] 14. **Apply to the hackathon before Oct 23** (Inference Sourcing track).

### Kit 12 build (in progress)
- [x] 1. Metal testnet: account, funded key, USDZ from the faucet, RPC endpoint, `@metalntwx/metal-pay` wired in. Guides: docs.metalntwx.com/agents. [#14](https://github.com/fozagtx/ecorouter/issues/14)
- [x] 2. Our own x402 providers: at least three, different prices and speeds, answers in chunks from a real model or stand-in text (`ClearingDebitServerScheme`).
- [x] 3. Pay per step through clearing: `depositToClearing` per job, `ClearingDebitScheme` per request (signs a running total, one payment at a time per key), facilitator `POST /clearing/position`, `withdrawFromClearing` (waits for the epoch).
- [x] 4. Customer card hold on Airwallex Payments (client built and tested offline; live sandbox run needs Airwallex keys): `POST /pa/payment_intents/create`, `/confirm` with test card `4035501000000008` and `authorization_type: 'pre_auth'`, `auto_capture: false`, then `/increment_authorization`, `/capture` (once, never above the hold), `/cancel`.
- [x] 5. Price from the provider's 402 offer on every request (no cached prices).
- [x] 6. Jobs and a float: per-job budget backed by its hold, one shared USDZ float set below the budgets combined, a float floor in code.
- [x] 7. Float rationing: when a job overruns (4x tokens) and the cheapest provider slows, decide which jobs reroute, which get the remaining float, and which customer is asked to raise their hold.

### What judges look for (guide: "Build around a financial decision")
- [x] 8. Model in the loop (`claudeJudge`, set `ANTHROPIC_API_KEY`; rule judge otherwise): rules, budgets and price lists stay in code; the model judges which answers are worth the more expensive provider and explains exceptions, through typed tools only.
- [x] 9. Approval step (auto-approve in the demo; `--ask` to approve by hand; a dashboard button is still to do): asking a customer to raise their hold is a human approval bound to the exact amount, currency and job.
- [x] 10. Put sandbox simulation calls behind one interface (`PaymentRail`, `HoldRail`) so they can be swapped without touching decision logic.
- [ ] 11. Demo run end to end: goal, plan, new information (overrun + slow provider), revised decision, then holds captured, rest released, unused deposits withdrawn.
- [ ] 12. Dashboard to show it: jobs, holds, float, per-step provider and price, reroutes, captures.

### Next (from the live runs)
- [ ] Run the card holds live: put `AIRWALLEX_CLIENT_ID` and `AIRWALLEX_API_KEY` (sandbox) in the env and rerun the demo. Watch for `REQUIRES_CUSTOMER_ACTION` (3DS) on confirm; the docs say `SKIP_3DS` needs enabling.
- [ ] Tune the live demo so a reroute is visible on chain: slow Swift earlier, or stagger job starts, so a later job quotes after Swift is measured slow.
- [ ] Each clearing deposit waits for an epoch window (about 10 to 20 s live). Depositing a little ahead when the float has slack would make runs faster.
- [ ] Withdraw unused deposits after epochs finalize (about 2 h): `withdrawFromClearing` returns `waiting` until then. The demo deposits exactly what each step needs, so little is left.
- [ ] Provider earnings sit in the provider clearing wallets under `.wallets/providers`; withdraw them the same way.

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

## Live evidence (Metal testnet, 2026-10-22)

- Float key `0xbc4b1FD73286DE1397f9a5Dd6c6481e6C30aeedD`, funded from the faucet ([tx](https://testnet.metalntwx.com/tx/0x6f17425e6e650cc244bb3064250e73adb24cd0002b233bbf3bfe39f4e8987e38)).
- Full demo run: 3 jobs, 12 deposits into clearing, 12 per-step clearing payments, overrun approval, all holds captured for exactly what was spent. Example deposits: [0x4bda3e8f…](https://testnet.metalntwx.com/tx/0x4bda3e8f6e85604f02710b1f3f7f65268df8592b46d847fb6f25ddb385796db8), [0x3d380f71…](https://testnet.metalntwx.com/tx/0x3d380f71e5fa68b82721327b63b3fefd08b1a11a8e0e93aa2b8e98909d1c564c).
- Lessons the live runs taught (now in code): float-key transactions must be serialized (nonce collisions); clearing pays before the answer, so a paid call is never abandoned early; live payment overhead is about 5 s per call, so the live latency target is 15 s.

## How to run

```bash
pnpm install
pnpm test                 # SDK + Kit 12 tests, offline
pnpm demo                 # Kit 12 story in the simulator

# Live on Metal testnet (keys stay in .wallets/, which is gitignored)
npx @metalntwx/metal-agent@0.3.1 key create --out .wallets/float-key.json
npx @metalntwx/metal-agent@0.3.1 fund <address> --network testnet
node packages/kit12/scripts/metal-rpc-endpoint.mjs .wallets/float-key.json > .wallets/rpc-url.txt
PROVIDER_WALLETS=.wallets/providers node packages/kit12/dist/serve.js &       # our x402 providers on :4021
METAL_RPC_URL=$(cat .wallets/rpc-url.txt) METAL_FLOAT_KEY=<privateKey> PROVIDERS_URL=http://127.0.0.1:4021 \
  METAL_WALLETS=.wallets/jobs node packages/kit12/dist/demo.js
# add AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY for real card holds, ANTHROPIC_API_KEY for the Claude judge
```

Older SDK commands:

```bash
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
- `.wallets/` (gitignored) holds credentials: `float-key.json` (testnet private key), `rpc-url.txt` (the Metal RPC URL is itself the credential), and the clearing wallets for jobs and providers. Never commit or paste them.
