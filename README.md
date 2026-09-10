# Arbiter

Arbiter is an economic control plane for autonomous software. V1 lets an agent
request the `web.search` capability while a Stellar smart account enforces a
USDC spending mandate.

Development follows the PRD's gated build order. The first gate is the smart
account in [`contracts/arbiter-account`](contracts/arbiter-account): later
control-plane work must not replace its on-chain financial boundary with an
application-only check.

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
