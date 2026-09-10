# EcoRouter

> Deterministic capability-based purchasing for autonomous agents, secured by Stellar Soroban smart accounts.

[![npm version](https://img.shields.io/npm/v/ecorouter.svg?style=flat-square)](https://www.npmjs.com/package/ecorouter)
[![SDK](https://img.shields.io/badge/SDK-TypeScript-3178c6?style=flat-square)](packages/sdk)
[![Contract](https://img.shields.io/badge/contract-Soroban%20Rust-7c3aed?style=flat-square)](contracts/ecorouter-account)
[![Network](https://img.shields.io/badge/network-Stellar%20Testnet-111?style=flat-square)](https://stellar.org)
[![Protocol](https://img.shields.io/badge/x402-V2%20exact-c8ff3d?style=flat-square)](packages/sdk/src/x402)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square)](LICENSE)

EcoRouter lets an autonomous agent request a capability (such as `web.search`) rather than binding itself to a specific API vendor. The local SDK discovers live prices from compatible providers via HTTP 402, evaluates proposals against on-chain mandates and local spend policies, deterministically selects the optimal economic provider, settles payment in USDC, and returns normalized results.

EcoRouter is entirely non-custodial and local-first: there are no intermediary servers, hosted databases, remote registries, or custodial wallets. All authorization is gated cryptographically on Stellar by a Soroban smart account.

![EcoRouter architecture](docs/assets/architecture.svg)

---

## Features

- **Capability-Based Routing**: Agents specify *what* they need (`web.search`), not *who* fulfills it.
- **Deterministic Selection**: Providers are evaluated via a pure mathematical economic cost formula—never an opaque LLM prompt.
- **On-Chain Soroban Mandates**: Budget limits, per-payment caps, expiration dates, and session keys are enforced on Stellar by smart contract logic.
- **x402 V2 Native**: Fully compliant with x402 V2 Exact payment challenges over standard HTTP 402 status codes.
- **Non-Custodial & Secure**: Private keys and session secrets remain local. Strict SSRF protection and atomic integer math prevent token leakage and rounding exploits.
- **Normalized Outputs**: Regardless of provider-specific formatting, agents receive a predictable, structured response.

---

## Architecture & Workflow

```
Agent Application
       │
       ▼  router.execute({ capability: "web.search", input: { query } })
  ┌─────────────────────────────────────────────────────────┐
  │ EcoRouter SDK                                           │
  │  1. Discover: Send concurrent probe to candidate APIs   │
  │  2. Challenge: Receive x402 V2 Exact HTTP 402 responses │
  │  3. Validate: Check network, asset, limits & deadlines  │
  │  4. Score: Compute economic cost deterministically      │
  │  5. Settle: Sign via session key against Soroban account│
  │  6. Execute: Fetch paid response and normalize data     │
  └─────────────────────────────────────────────────────────┘
       │                                       │
       ▼                                       ▼
  Selected Provider API               Stellar Soroban Contract
  (HTTP 200 + Raw Results)            (__check_auth Mandate Gate)
```

1. **Discovery**: The SDK issues a probe request to configured provider endpoints.
2. **Challenge**: Providers respond with an `x402 V2 exact` challenge detailing price, token asset, and recipient address.
3. **Policy & Mandate Gate**: EcoRouter verifies that the challenge matches the configured network, token address, maximum spend limit, and active session lifetime.
4. **Deterministic Ranking**: Eligible offers are scored by expected economic efficiency.
5. **Settlement**: The SDK authorizes payment using the restricted session key. The Soroban smart account contract executes `__check_auth` to ensure the payment does not violate the active mandate.
6. **Delivery**: The chosen provider verifies on-chain payment and delivers the payload, which EcoRouter normalizes into a uniform schema.

![Execution flow](docs/assets/execution-flow.svg)

---

## Economic Scoring

Provider selection is strictly reproducible and transparent. For every eligible challenge:

$$\text{Expected Effectiveness} = \text{qualityScore} \times \text{successRate}$$

$$\text{Economic Cost} = \frac{\text{priceAtomic}}{\text{Expected Effectiveness}}$$

- **Primary Sort**: Lowest `economicCost` wins.
- **Tie Breakers**: If costs are equal, the lower raw price wins. If prices match, provider IDs are sorted lexically.
- **Precision**: All token accounting uses 64-bit integer atomic units (e.g. `10,000` = `0.01 USDC`). Floating-point arithmetic is never used for currency values.

---

## Quickstart

### Installation

```bash
# pnpm
pnpm add ecorouter

# npm
npm install ecorouter

# yarn
yarn add ecorouter
```

### Basic Usage

```typescript
import { EcoRouter } from "ecorouter";

// Initialize the router with your smart account and candidate providers
const router = new EcoRouter({
  account: process.env.ECOROUTER_ACCOUNT_ADDRESS!,
  sessionSecret: process.env.ECOROUTER_SESSION_SECRET!,
  providers: [
    {
      id: "search-provider-alpha",
      capability: "web.search",
      endpoint: "https://search-a.api.net/search",
      qualityScore: 0.92
    },
    {
      id: "search-provider-beta",
      capability: "web.search",
      endpoint: "https://search-b.api.net/search",
      qualityScore: 0.85
    }
  ]
});

// Execute capability purchase
const response = await router.execute({
  executionId: "exec-" + Date.now(),
  capability: "web.search",
  input: {
    query: "Stellar Soroban smart account best practices"
  },
  policy: {
    maxSpendUsdc: "0.05",
    minimumQuality: 0.80
  }
});

console.log("Selected Provider:", response.decision.selectedProviderId);
console.log("Settlement Hash:", response.payment.transactionHash);
console.log("Normalized Results:", response.output.results);
```

---

## Smart Account Contract

The Soroban smart account (`contracts/ecorouter-account`) implements cryptographic session validation. It holds funds and authenticates spending through the standard `__check_auth` interface.

### On-Chain Mandate Structure

```rust
pub struct Mandate {
    pub session_public_key: BytesN<32>,
    pub asset: Address,
    pub total_limit: i128,
    pub spent: i128,
    pub max_payment: i128,
    pub expires_at: u64,
    pub revoked: bool,
}
```

The smart account enforces:
- **Session Signature Verification**: Payments must be signed by the currently active session keypair.
- **Asset Integrity**: Only the specified asset (e.g. USDC) can be transferred under the mandate.
- **Per-Transaction Cap**: Individual transfers cannot exceed `max_payment`.
- **Cumulative Budget**: Total expenditures cannot exceed `total_limit`.
- **Time Bounding**: Transactions after `expires_at` are rejected.
- **Immediate Revocation**: The account owner can revoke active sessions at any time.

### Building & Testing Contracts

```bash
# Run contract unit and integration tests
cargo test --workspace

# Build the optimized Soroban WebAssembly binary
cargo build --target wasm32v1-none --release -p ecorouter-account
```

---

## Security Model

- **Zero Remote Custody**: Master account keys and session secrets are stored and processed only within the local runtime.
- **Bounded Attack Surface**: Session keys are restricted by the smart contract in both amount and time. Compromising a session key cannot drain unallocated account funds.
- **SSRF Hardening**: The SDK strictly parses and validates provider endpoints. Requests to `localhost`, link-local, private subnet ranges, and cloud metadata endpoints (e.g. `169.254.169.254`) are prohibited.
- **Deterministic Settlement State**: If a settlement transaction status cannot be unambiguously determined, execution halts immediately with `PAYMENT_SETTLEMENT_UNKNOWN` to prevent double-spending.

---

## Repository Structure

```text
.
├── packages/sdk/                     # TypeScript SDK (published as ecorouter)
│   ├── src/
│   │   ├── ecorouter.ts              # Core router orchestrator
│   │   ├── providers/                # x402 probe and response normalization
│   │   ├── router/                   # Deterministic economic cost sorting
│   │   └── x402/                     # Challenge validation & schema checks
│   └── test/                         # Unit and integration test suites
├── contracts/ecorouter-account/      # Stellar Soroban smart account
│   ├── src/
│   │   ├── lib.rs                    # Smart account entry points & __check_auth
│   │   └── test.rs                   # Contract verification test cases
│   └── Cargo.toml
├── examples/
│   └── search-agent.ts               # End-to-end agent integration example
├── docs/                             # Static documentation & landing page
└── Cargo.toml                        # Workspace configuration
```

---

## Development

```bash
# Install workspace dependencies
pnpm install

# Build SDK and packages
pnpm build

# Run TypeScript test suite
pnpm test

# Run Rust contract tests
cargo test --workspace
```

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
