# Airwallex integration

Track: Airwallex Agentic Banking Hackathon, Kit 12 "Inference Sourcing" (source each AI step by live price, reroute when budgets or speed change). Track setup: Metal testnet access.

Status: built into `packages/sdk/src/airwallex/` and tested offline against the documented API shapes. Not yet run against a live sandbox account (needs sandbox API keys and Issuing enabled on the account).

## What is built

| Piece | Airwallex API | SDK |
|-------|---------------|-----|
| Auth | `POST /api/v1/authentication/login` with `x-client-id` + `x-api-key`; 30 min bearer token | `AirwallexClient`, token reused until a minute before expiry, 429 retried with backoff |
| Funding wallet | `GET /api/v1/balances/current` | `checkFunding(client, policies)` refuses caps that sum past the available USD balance |
| Card per (agent, provider) | `POST /api/v1/issuing/cards/create` with `authorization_controls.transaction_limits.limits[]` (`PER_TRANSACTION`, `DAILY`/`WEEKLY`/`MONTHLY`) and optional `allowed_merchant_categories` | `ProviderCards.ensure()`, `controlsFor(policy)`, `syncLimits()` via `POST /api/v1/issuing/cards/{id}/update` |
| Remaining limits | `GET /api/v1/issuing/cards/{id}/limits` | `client.cardLimits()` |
| FX on quotes | `GET /api/v1/fx/rates/current` (amounts read from `rate_details` CLIENT level) | `AirwallexFxPrices`, a price source that converts EUR/other prices to USD before routing |
| Reconciliation | `issuing.transaction.succeeded` / `.failed` webhooks, `x-timestamp` + `x-signature` = hex HMAC-SHA256(secret, timestamp + raw body) | `verifyWebhook()`, `issuingTransaction()`, `Reconciler` (dedupes by transaction id, tracks card spend vs receipts, a `LIMIT_EXCEEDED` / `INSUFFICIENT_FUNDS` decline marks the provider unhealthy so the next step reroutes) |

Card limits mirror the agent's **period cap**, not the per-step ceiling: providers bill a card per invoice or credit top-up, not per API call. The per-step ceiling is enforced by the router.

## Sandbox run (next)

1. Create sandbox API keys at sandbox.airwallex.com (Account > Developer > API keys). Ask for Issuing to be enabled.
2. Create a cardholder (`POST /api/v1/issuing/cardholders/create`) and wait for status `READY`.
3. Fund the sandbox wallet, run `checkFunding`, create cards with `ProviderCards`.
4. Register a webhook for `issuing.transaction.*`, simulate card transactions with the sandbox simulation APIs, and check `Reconciler.drift()`.

Host: `https://api.sandbox.airwallex.com` (production `https://api.airwallex.com`). Amounts are decimal major units.

## Open questions

- Which Metal testnet resources the Inference Sourcing kit expects.
- Whether each provider accepts card billing or only prepaid credit top-ups (affects how often the card is charged).
- Airwallex marks `GET /api/v1/issuing/transactions` as legacy in favour of `card_transactions`; the webhook path does not depend on it.
