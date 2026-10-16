#!/usr/bin/env bash
# Deploys the service registry and a team account to Stellar testnet, registers
# demo services, and writes packages/app/.env.local so the app's Testnet mode
# points at them.
#
# Requires: stellar CLI (https://developers.stellar.org/docs/tools/cli), Rust
# with the wasm32v1-none target.
#
#   ./scripts/deploy-testnet.sh            # owner identity "owner"
#   OWNER=alice ./scripts/deploy-testnet.sh
set -euo pipefail

NETWORK=testnet
OWNER="${OWNER:-owner}"
# Circle's testnet USDC issuer.
USDC_ISSUER="${USDC_ISSUER:-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM="$ROOT/target/wasm32v1-none/release"

if ! stellar keys address "$OWNER" >/dev/null 2>&1; then
  stellar keys generate "$OWNER" --network "$NETWORK" --fund
fi
OWNER_ADDR="$(stellar keys address "$OWNER")"
echo "owner: $OWNER_ADDR"

(cd "$ROOT" && cargo build --target wasm32v1-none --release -p service-registry -p team-account)

USDC_SAC="$(stellar contract id asset --asset "USDC:$USDC_ISSUER" --network "$NETWORK")"
stellar contract asset deploy --asset "USDC:$USDC_ISSUER" --source "$OWNER" --network "$NETWORK" >/dev/null 2>&1 || true
echo "usdc: $USDC_SAC"

REGISTRY="$(stellar contract deploy --wasm "$WASM/service_registry.wasm" --source "$OWNER" --network "$NETWORK" \
  -- --owner "$OWNER_ADDR")"
echo "registry: $REGISTRY"

ACCOUNT="$(stellar contract deploy --wasm "$WASM/team_account.wasm" --source "$OWNER" --network "$NETWORK" \
  -- --owner "$OWNER_ADDR" --asset "$USDC_SAC" --registry "$REGISTRY")"
echo "team account: $ACCOUNT"

# Demo services. Each pays a fresh testnet account; replace with real payees.
register() {
  local id="$1" name="$2"
  local who="svc-$id"
  stellar keys address "$who" >/dev/null 2>&1 || stellar keys generate "$who" --network "$NETWORK" --fund
  stellar contract invoke --id "$REGISTRY" --source "$OWNER" --network "$NETWORK" -- \
    register --id "$id" --name "$name" --payee "$(stellar keys address "$who")" >/dev/null
  echo "  registered $id -> $(stellar keys address "$who")"
}
register inference "Inference credits"
register search "Web search API"
register data "Market data feed"
register gpu "GPU hours"
register storage "Object storage"

cat > "$ROOT/packages/app/.env.local" <<ENV
VITE_STELLAR_NETWORK=testnet
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_TEAM_ACCOUNT_ID=$ACCOUNT
VITE_REGISTRY_ID=$REGISTRY
VITE_USDC_ID=$USDC_SAC
ENV
echo "wrote packages/app/.env.local"
echo
echo "Fund the account with testnet USDC (https://faucet.circle.com), then add spenders from the app."
