# EcoRouter

> Spending rules for teams and their AI agents, enforced on Stellar.

[![Contracts](https://img.shields.io/badge/contracts-Soroban%20Rust-7c3aed?style=flat-square)](contracts)
[![App](https://img.shields.io/badge/app-React-3178c6?style=flat-square)](packages/app)
[![Network](https://img.shields.io/badge/network-Stellar%20Testnet-111?style=flat-square)](https://stellar.org)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square)](LICENSE)

EcoRouter is one shared USDC account for a team's people and AI agents. Every spender pays under its own policy: an allowance per period, a cap per payment, a number of payments per period, an end date and a list of approved services. The policy is checked by the Soroban contract that holds the money, every time money moves.

**The agent proposes. Only the contract authorizes.**

- **Open the app:** [ecorouter.xyz/app](https://ecorouter.xyz/app/). Install Freighter, switch it to Testnet, and connect.
- **Docs:** [ecorouter.xyz/docs](https://ecorouter.xyz/docs/)

---

## What you can do

| | |
| --- | --- |
| **Give every spender a policy** | Allowance per day, week or month; cap per payment; payments per period; end date; approved services. Pause or remove a spender at any time. |
| **Pay only registered services** | `pay` takes a service id, never an address. The service registry resolves who gets paid. An id nobody registered resolves to nothing, so there is no one to pay. |
| **Over a limit, the owner decides** | A payment outside the rules is held and nothing moves. A person can send it to the owner's **Approvals** screen with the rule that caught it and how far over it went. Approving moves no money; settlement is its own transaction, and it refuses if the service's payee changed after the request was filed. |
| **Ask the assistant** | Type "top up our inference credits by $120". The assistant can only call one tool with four fields: a service from your list (an enum), an amount, a currency and a memo. There is no address field, so an invented recipient cannot be written down. |
| **Run AI agents** | An agent has its own Stellar key and its own policy. The SDK worker pays on a schedule; refused payments stop there because agents cannot file approval requests. |
| **Read every receipt** | Paid, held, asked, approved, declined, settled. A refusal is a normal outcome, shown with the arithmetic behind it. |

### Every payment passes these checks, in this order

```
pay(spender, service, amount, memo, key)

 1  account not paused
 2  spender has a policy
 3  spender not paused
 4  policy not expired
 5  amount > 0
 6  service on spender's list
 7  key not used before (no double pay)
 8  amount <= cap per payment
 9  payments this period < limit
10  spent this period + amount <= allowance
11  registry resolves the service (not unknown, not suspended)
12  account balance covers it
13  transfer, receipt event
```

The first failed check refuses the call and nothing moves. Checks 6, 8, 9 and 10 are the ones a person can ask the owner to override, once. Source: `contracts/team-account/src/lib.rs`.

---

## Repository

```text
.
├── contracts/
│   ├── team-account/        # Soroban: shared account, per-spender policies, approval queue
│   ├── service-registry/    # Soroban: service id -> payee; unknown ids fail
│   └── ecorouter-account/   # Legacy single-mandate smart account (SDK era)
├── packages/
│   ├── app/                 # The product: React app served at /app
│   │   ├── src/engine/      #   app types, validation and contract error handling
│   │   ├── src/chain/       #   Stellar testnet backend (Soroban RPC + Freighter)
│   │   ├── src/assistant/   #   sentence -> constrained payment draft
│   ├── site/                # Landing page (Astro)
│   ├── docs/                # Documentation (Fumadocs)
│   └── sdk/                 # Team-account agent SDK and scheduled worker
├── scripts/deploy-testnet.sh
└── docs/                    # Built static site: landing page, /app, /docs
```

## Run it

```bash
pnpm install
pnpm dev:app          # http://localhost:5173/app/ — connect Freighter on Testnet
```

Install Freighter, switch it to Testnet, connect in the app, then use **Settings → Add funds** to transfer testnet USDC into the team account. Add spenders from the app using their own `G…` addresses. An agent runs outside the app with the secret for its own spender address:

```bash
pnpm --filter ecorouter build
AGENT_SECRET="replace-with-agent-secret" \
AGENT_SERVICE=search \
AGENT_AMOUNT=0.25 \
AGENT_EVERY=day \
node packages/sdk/dist/worker.js
```

### On Stellar testnet

```bash
cargo build --target wasm32v1-none --release -p service-registry -p team-account
pnpm --filter @ecorouter/app deploy:testnet   # JS SDK only, no Stellar CLI needed
pnpm dev:app                                  # install Freighter, switch to Testnet, then connect
```

`deploy:testnet` funds an owner with Friendbot, wraps testnet USDC, uploads and deploys both contracts, registers five demo services (each payee gets a USDC trustline), then reads the deployment back: owner, registry link, service list, and that an unregistered id reverts with `UnknownService`. It writes `packages/app/.env.local` and `deployments/testnet.json` (ids, wasm hashes, transaction hashes); generated secrets go to `.deploy/` (gitignored). `./scripts/deploy-testnet.sh` does the same with the Stellar CLI.
The app reads contract ids from the committed `deployments/testnet.json`, so commit that file after a redeploy; `packages/app/.env.local` is only an optional override.

The worker uses the same schedule key for every retry of a time slot. It calls `is_key_used` before paying and keeps no disk state. If a payment call times out, retry with the same key; error 7 (`DuplicatePayment`) means the first attempt already paid.

## Test

```bash
pnpm --filter ecorouter typecheck
pnpm --filter ecorouter test
pnpm --filter ecorouter build
pnpm --filter @ecorouter/app test
pnpm --filter @ecorouter/app typecheck
pnpm build:site                 # landing page, docs and app into docs/
```

The contract tests live with the Rust crates. The SDK's offline test suite does not submit testnet transactions; its separate live script is gated by `ECOROUTER_LIVE=1`.

## Security and status

- **Testnet only. Not audited.** The contracts have tests written by the people who wrote the contracts, and no independent review. Use test funds.
- **Nobody but the owner can withdraw.** The USDC sits in the team-account contract. Every function that loosens a rule is owner-only.
- **Spenders sign their own payments.** `pay` requires the spender's signature (`require_auth`). The app and the assistant only prepare calls.
- **Known edges, kept on purpose:** a service's payee can move its own payout address, and in-policy payments follow it (an approved exception does not: it refuses to settle). The registry owner can suspend a service. Settled exceptions do not count against the spender's allowance. `set_policy` overwrites every limit at once, and a zero limit is rejected rather than meaning "no limit".
- **What the app stores locally:** display names and refusals that never reached the chain are kept in your browser. Everything that authorizes a payment is on chain.

## License

Apache License 2.0. See [LICENSE](LICENSE).
