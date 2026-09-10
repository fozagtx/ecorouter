# Arbiter

Arbiter is an economic control plane for autonomous software. V1 lets an agent
request the `web.search` capability while a Stellar smart account enforces a
USDC spending mandate.

V1 has two product deliverables: the local TypeScript package in
[`packages/sdk`](packages/sdk) and the smart account in
[`contracts/arbiter-account`](contracts/arbiter-account). There is no hosted
Arbiter API, database, dashboard, or custodial key service.

## Smart-account contract

The contract stores exactly one active mandate containing the session signer,
asset, total limit, amount spent, maximum payment, expiry, and revocation state.
Only the owner can create or replace a mandate, revoke it, or withdraw tokens.
The session signer is accepted only by `__check_auth`, and only for one exact
token `transfer` from the contract account that satisfies the mandate.

```bash
cargo test --workspace
cargo build --target wasm32v1-none --release -p arbiter-account
```

Crate versions are pinned so the resulting contract is reproducible.

## SDK

The SDK performs live challenge discovery, policy and mandate validation,
deterministic economic routing, local payment orchestration, normalization, and
process-local idempotency. Payment amounts are represented as USDC atomic-unit
`bigint` values.

```bash
pnpm build
pnpm test
```

The static product explainer is in [`docs`](docs) and deploys to GitHub Pages
through `.github/workflows/pages.yml`.
