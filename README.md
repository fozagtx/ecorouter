# EcoRouter

> Spending rules for teams and their AI agents, enforced on Stellar.

[![Contracts](https://img.shields.io/badge/contracts-Soroban%20Rust-7c3aed?style=flat-square)](contracts)
[![App](https://img.shields.io/badge/app-React-3178c6?style=flat-square)](packages/app)
[![Network](https://img.shields.io/badge/network-Stellar%20Testnet-111?style=flat-square)](https://stellar.org)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square)](LICENSE)

EcoRouter is one shared USDC account for a team's people and AI agents. Every spender pays under its own policy: an allowance per period, a cap per payment, a number of payments per period, an end date and a list of approved services. The policy is checked by the Soroban contract that holds the money, every time money moves.

**The agent proposes. Only the contract authorizes.**

- **Open the app:** [ecorouter.xyz/app](https://ecorouter.xyz/app/). The sandbox needs no wallet.
- **Docs:** [ecorouter.xyz/docs](https://ecorouter.xyz/docs/)

---

## What you can do

| | |
| --- | --- |
| **Give every spender a policy** | Allowance per day, week or month; cap per payment; payments per period; end date; approved services. Pause or remove a spender at any time. |
| **Pay only registered services** | `pay` takes a service id, never an address. The service registry resolves who gets paid. An id nobody registered resolves to nothing, so there is no one to pay. |
| **Over a limit, the owner decides** | A payment outside the rules is held and nothing moves. A person can send it to the owner's **Approvals** screen with the rule that caught it and how far over it went. Approving moves no money; settlement is its own transaction, and it refuses if the service's payee changed after the request was filed. |
| **Ask the assistant** | Type "top up our inference credits by $120". The assistant can only call one tool with four fields: a service from your list (an enum), an amount, a currency and a memo. There is no address field, so an invented recipient cannot be written down. |
| **Run AI agents** | An agent has its own Stellar key and its own policy, and pays on a schedule. Its refused payments stop there: agents cannot file approval requests. |
| **Read every receipt** | Paid, held, asked, approved, declined, settled. A refusal is a normal outcome, shown with the arithmetic behind it. |

### Every payment passes these checks, in this order

```
pay(spender, service, amount, memo, key)

 1  account not paused          6  key not used before (no double pay)
 2  spender has a policy        7  amount <= cap per payment
 3  spender not paused          8  payments this period < limit
 4  policy not expired          9  spent this period + amount <= allowance
 5  service on spender's list  10  registry resolves the service (not unknown, not suspended)
                               11  account balance covers it  ->  transfer, receipt event
```

The first failed check refuses the call and nothing moves. Checks 5, 7, 8 and 9 are the ones a person can ask the owner to override, once.

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
│   │   ├── src/engine/      #   policy mirror of the contract + in-browser sandbox
│   │   ├── src/chain/       #   Stellar testnet backend (Soroban RPC + Freighter)
│   │   ├── src/assistant/   #   sentence -> constrained payment draft
│   │   └── worker/          #   agent worker: pays on a schedule with the agent's own key
│   ├── site/                # Landing page (Astro)
│   ├── docs/                # Documentation (Fumadocs)
│   └── sdk/                 # Legacy capability-routing SDK
├── scripts/deploy-testnet.sh
└── docs/                    # Built static site: landing page, /app, /docs
```

## Run it

```bash
pnpm install
pnpm dev:app          # http://localhost:5173/app/ — choose "Open the sandbox"
```

The sandbox is a team account in your browser with $5,000 in test dollars, two people (Ada the owner, Marcus) and two agents (Scout, Atlas). It runs a TypeScript mirror of the contract's checks (`packages/app/src/engine/policy.ts`), tested case for case against the Rust tests. Switch between Ada and Marcus in the sidebar to see both sides of an approval.

### On Stellar testnet

```bash
# needs the stellar CLI and the wasm32v1-none Rust target
./scripts/deploy-testnet.sh     # deploys registry + team account, registers demo services,
                                # writes packages/app/.env.local
pnpm dev:app                    # choose "Connect Freighter"
```

Fund the team-account contract by sending it testnet USDC. Add spenders from the app (their own `G…` addresses). Agents run outside the browser with their own key:

```bash
AGENT_SECRET=S... TEAM_ACCOUNT_ID=C... \
  pnpm --filter @ecorouter/app agent --service search --amount 4 --every day
```

The worker writes each payment's idempotency key to disk before submitting it, so after a crash it asks the contract whether that key was used instead of paying again.

## Test

```bash
cargo test --workspace          # 37 team-account + 7 registry tests (+ legacy)
pnpm --filter @ecorouter/app test
pnpm --filter @ecorouter/app typecheck
pnpm build:site                 # landing page, docs and app into docs/
```

Every contract rule has a test that the allowed case goes through and a test that the refused case fails with that rule's own error code.

## Security and status

- **Testnet only. Not audited.** The contracts have tests written by the people who wrote the contracts, and no independent review. Use test funds.
- **Nobody but the owner can withdraw.** The USDC sits in the team-account contract. Every function that loosens a rule is owner-only.
- **Spenders sign their own payments.** `pay` requires the spender's signature (`require_auth`). The app and the assistant only prepare calls.
- **Known edges, kept on purpose:** a service's payee can move its own payout address, and in-policy payments follow it (an approved exception does not: it refuses to settle). The registry owner can suspend a service. Settled exceptions do not count against the spender's allowance. `set_policy` overwrites every limit at once, and a zero limit is rejected rather than meaning "no limit".
- **What the app stores locally:** in testnet mode, display names, agent schedules and refusals that never reached the chain are kept in your browser. Everything that authorizes a payment is on chain.

## Legacy SDK

EcoRouter started as a TypeScript SDK for capability-based purchasing over x402 (`packages/sdk`, `contracts/ecorouter-account`). It still builds and its docs live under [Legacy SDK](https://ecorouter.xyz/docs/legacy/). New work happens in the product.

## License

Apache License 2.0. See [LICENSE](LICENSE).
