import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  AirwallexClient,
  AirwallexError,
  AirwallexFxPrices,
  HealthTracker,
  ProviderCards,
  Reconciler,
  checkFunding,
  controlsFor,
  issuingTransaction,
  usd,
  verifyWebhook,
} from "../dist/index.js";

const policy = { agentId: "research", periodCap: usd(50), period: "day", stepCeiling: usd(0.4), kinds: ["search"], providers: [] };

// Answers like the Airwallex sandbox would, per documented path.
function sandbox(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname, query: Object.fromEntries(u.searchParams), headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    if (u.pathname === "/api/v1/authentication/login") {
      return new Response(JSON.stringify({ token: "tok", expires_at: new Date(Date.now() + 30 * 60_000).toISOString() }), { status: 201 });
    }
    const handler = routes[`${init.method ?? "GET"} ${u.pathname}`];
    if (!handler) return new Response(JSON.stringify({ code: "not_found", message: u.pathname }), { status: 404 });
    const [status, body] = handler(calls.at(-1));
    return new Response(JSON.stringify(body), { status });
  };
  return { f, calls };
}

test("logs in once, then sends the bearer token on every call", async () => {
  const s = sandbox({ "GET /api/v1/balances/current": () => [200, [{ currency: "USD", available_amount: 120.5 }]] });
  const c = new AirwallexClient({ clientId: "id", apiKey: "key", fetch: s.f });
  await c.balances("cash");
  await c.balances("cash");
  const logins = s.calls.filter((x) => x.path === "/api/v1/authentication/login");
  assert.equal(logins.length, 1);
  assert.equal(logins[0].headers["x-client-id"], "id");
  assert.equal(logins[0].headers["x-api-key"], "key");
  assert.equal(s.calls[1].headers.authorization, "Bearer tok");
  assert.equal(s.calls[1].query.account_type, "cash");
});

test("defaults to the sandbox host", async () => {
  let seen;
  const c = new AirwallexClient({ clientId: "i", apiKey: "k", fetch: async (url) => { seen ??= String(url); return new Response("{}", { status: 500 }); } });
  await assert.rejects(c.balances());
  assert.match(seen, /^https:\/\/api\.sandbox\.airwallex\.com\/api\/v1\/authentication\/login/);
});

test("card controls mirror the agent's period cap", () => {
  assert.deepEqual(controlsFor(policy).transaction_limits, {
    currency: "USD",
    limits: [{ amount: 50, interval: "PER_TRANSACTION" }, { amount: 50, interval: "DAILY" }],
  });
  const tiny = controlsFor({ ...policy, periodCap: usd(0.004), period: "month" });
  assert.deepEqual(tiny.transaction_limits.limits, [{ amount: 0.01, interval: "PER_TRANSACTION" }, { amount: 0.01, interval: "MONTHLY" }]);
});

test("creates one virtual card per agent and provider, with the documented body", async () => {
  let n = 0;
  const s = sandbox({ "POST /api/v1/issuing/cards/create": () => [202, { card_id: `card-${++n}`, card_status: "ACTIVE", cardholder_id: "ch" }] });
  const cards = new ProviderCards(new AirwallexClient({ clientId: "i", apiKey: "k", fetch: s.f }), { cardholderId: "ch", createdBy: "Team Owner" });
  const a = await cards.ensure(policy, "exa", ["7372"]);
  const again = await cards.ensure(policy, "exa");
  assert.equal(a.cardId, "card-1");
  assert.equal(again.cardId, "card-1", "second call reuses the card");
  const body = s.calls.find((x) => x.path === "/api/v1/issuing/cards/create").body;
  assert.equal(body.form_factor, "VIRTUAL");
  assert.equal(body.cardholder_id, "ch");
  assert.equal(body.program.purpose, "COMMERCIAL");
  assert.equal(typeof body.request_id, "string");
  assert.deepEqual(body.authorization_controls.allowed_merchant_categories, ["7372"]);
  assert.equal(body.metadata.ecorouter_provider, "exa");
});

test("funding check refuses caps the wallet cannot cover", async () => {
  const s = sandbox({ "GET /api/v1/balances/current": () => [200, [{ currency: "USD", available_amount: 60 }, { currency: "EUR", available_amount: 999 }]] });
  const c = new AirwallexClient({ clientId: "i", apiKey: "k", fetch: s.f });
  assert.equal((await checkFunding(c, [policy])).ok, true);
  const r = await checkFunding(c, [policy, { ...policy, agentId: "b", periodCap: usd(20) }]);
  assert.deepEqual(r, { ok: false, available: usd(60), committed: usd(70) });
});

test("FX converts non-USD prices with the CLIENT rate amounts", async () => {
  const s = sandbox({
    "GET /api/v1/fx/rates/current": () => [200, { rate: 1, rate_details: [{ level: "CLIENT", buy_amount: 1000, sell_amount: 1085 }] }],
  });
  const fx = new AirwallexFxPrices(new AirwallexClient({ clientId: "i", apiKey: "k", fetch: s.f }), {
    mistral: { price: { unit: "request", usd: 0.01 }, currency: "EUR", source: "sheet" },
  });
  const q = await fx.quote("mistral");
  assert.ok(Math.abs(q.price.usd - 0.01085) < 1e-12);
  const call = s.calls.find((x) => x.path === "/api/v1/fx/rates/current");
  assert.deepEqual(call.query, { buy_currency: "EUR", sell_currency: "USD", buy_amount: "1000" });
});

test("API errors carry the Airwallex code and trace id; 429 is retried", async () => {
  let hits = 0;
  const s = sandbox({
    "GET /api/v1/issuing/cards/x": () => [400, { code: "invalid_argument", message: "bad", trace_id: "t1" }],
    "GET /api/v1/issuing/cards/y/limits": () => (++hits < 2 ? [429, { code: "too_many_requests" }] : [200, { currency: "USD", limits: [] }]),
  });
  const c = new AirwallexClient({ clientId: "i", apiKey: "k", fetch: s.f });
  await assert.rejects(c.getCard("x"), (e) => e instanceof AirwallexError && e.code === "invalid_argument" && e.traceId === "t1");
  assert.deepEqual(await c.cardLimits("y"), { currency: "USD", limits: [] });
  assert.equal(hits, 2);
});

test("webhook signature is HMAC-SHA256 of timestamp + raw body", () => {
  const secret = "whsec";
  const now = 1_790_000_000_000;
  const body = JSON.stringify({ id: "evt1", name: "issuing.transaction.succeeded", created_at: "2026-10-22T00:00:00Z", data: { card_id: "card-1", transaction_id: "t1" } });
  const sig = createHmac("sha256", secret).update(String(now) + body).digest("hex");
  const evt = verifyWebhook(body, { "x-timestamp": String(now), "x-signature": sig }, secret, { now });
  assert.equal(issuingTransaction(evt).card_id, "card-1");
  assert.throws(() => verifyWebhook(body + " ", { "x-timestamp": String(now), "x-signature": sig }, secret, { now }), /does not match/);
  assert.throws(() => verifyWebhook(body, { "x-timestamp": String(now), "x-signature": sig }, secret, { now: now + 10 * 60_000 }), /tolerance/);
});

test("issuing events are read from data or data.object", () => {
  const tx = { card_id: "c", transaction_id: "t" };
  assert.equal(issuingTransaction({ name: "issuing.transaction.failed", data: { object: tx } }).card_id, "c");
  assert.equal(issuingTransaction({ name: "issuing.card.active", data: tx }), null);
});

test("reconciler tracks card spend, ignores duplicates, and reroutes on a card decline", () => {
  const cards = new ProviderCards(null, { cardholderId: "ch", createdBy: "x" });
  cards.restore([{ agentId: "research", providerId: "exa", cardId: "card-1" }]);
  const health = new HealthTracker({ maxFailures: 1 });
  const rec = new Reconciler(cards, health);

  rec.receipt({ agentId: "research", providerId: "exa", cost: usd(10) });
  const tx = { transaction_id: "t1", card_id: "card-1", status: "CLEARED", transaction_type: "CLEARING", billing_amount: -10.5, billing_currency: "USD" };
  assert.equal(rec.transaction(tx).cardSpend, usd(10.5));
  assert.equal(rec.transaction(tx), null, "duplicate delivery ignored");
  assert.deepEqual(rec.drift(), [{ agentId: "research", providerId: "exa", card: usd(10.5), receipts: usd(10), drift: usd(0.5) }]);

  rec.transaction({ transaction_id: "t2", card_id: "card-1", status: "FAILED", transaction_type: "AUTHORIZATION", billing_amount: -80, failure_reason: "LIMIT_EXCEEDED" });
  assert.equal(health.healthy("exa"), false, "a card decline takes the provider out of routing");
});

import { AirwallexHolds } from "../dist/index.js";

test("card hold: pre_auth confirm, increment sends the new total, capture once, cancel", async () => {
  const s = sandbox({
    "POST /api/v1/pa/payment_intents/create": () => [201, { id: "int_1", status: "REQUIRES_PAYMENT_METHOD", amount: 2.5, currency: "USD" }],
    "POST /api/v1/pa/payment_intents/int_1/confirm": () => [200, { id: "int_1", status: "REQUIRES_CAPTURE", amount: 2.5, currency: "USD" }],
    "POST /api/v1/pa/payment_intents/int_1/increment_authorization": (c) => [200, { id: "int_1", status: "REQUIRES_CAPTURE", amount: c.body.amount, currency: "USD" }],
    "POST /api/v1/pa/payment_intents/int_1/capture": (c) => [200, { id: "int_1", status: "SUCCEEDED", amount: 4, captured_amount: c.body.amount, currency: "USD" }],
    "POST /api/v1/pa/payment_intents/int_1/cancel": () => [200, { id: "int_1", status: "CANCELLED", amount: 4, currency: "USD" }],
  });
  const holds = new AirwallexHolds(new AirwallexClient({ clientId: "i", apiKey: "k", fetch: s.f }));

  let h = await holds.place("job-a", usd(2.501));
  const create = s.calls.find((x) => x.path.endsWith("/create")).body;
  assert.equal(create.amount, 2.51, "rounded up to whole cents so the hold covers the budget");
  const confirm = s.calls.find((x) => x.path.endsWith("/confirm")).body;
  assert.deepEqual(confirm.payment_method_options, { card: { authorization_type: "pre_auth", auto_capture: false } });
  assert.equal(confirm.payment_method.card.number, "4035501000000008");
  assert.equal(h.held, usd(2.5));

  h = await holds.increase(h, usd(4));
  assert.equal(s.calls.find((x) => x.path.endsWith("/increment_authorization")).body.amount, 4, "new total, not the delta");
  await assert.rejects(holds.capture(h, usd(4.01)), /above the hold/);
  h = await holds.capture(h, usd(3.219));
  assert.equal(s.calls.find((x) => x.path.endsWith("/capture")).body.amount, 3.21, "capture rounds down");
  assert.equal(h.status, "captured");
  await assert.rejects(holds.capture(h, usd(1)), /captured/);
});

test("a hold that is not authorized fails loudly", async () => {
  const s = sandbox({
    "POST /api/v1/pa/payment_intents/create": () => [201, { id: "int_2", status: "REQUIRES_PAYMENT_METHOD", amount: 1, currency: "USD" }],
    "POST /api/v1/pa/payment_intents/int_2/confirm": () => [200, { id: "int_2", status: "REQUIRES_CUSTOMER_ACTION", amount: 1, currency: "USD" }],
  });
  const holds = new AirwallexHolds(new AirwallexClient({ clientId: "i", apiKey: "k", fetch: s.f }));
  await assert.rejects(holds.place("job-b", usd(1)), /REQUIRES_CUSTOMER_ACTION/);
});
