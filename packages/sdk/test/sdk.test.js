import test from "node:test";
import assert from "node:assert/strict";
import { Arbiter, EcoRouter, formatUsdc, parseUsdc, selectProvider, validateChallenge } from "../dist/index.js";

test("EcoRouter and Arbiter export identity", () => {
  assert.equal(EcoRouter, Arbiter);
});

test("money uses exact USDC atomic units", () => {
  assert.equal(parseUsdc("0.05"), 500000n);
  assert.equal(formatUsdc(500000n), "0.05");
  assert.throws(() => parseUsdc("0.00000001"));
});

test("execute challenges every provider, routes, normalizes, and is idempotent", async () => {
  let challengeCalls = 0;
  let settlements = 0;
  const challenge = amount => Buffer.from(JSON.stringify({ x402Version: 2, scheme: "exact", network: "stellar:testnet", asset: "CUSDC", amount, payTo: "CDEST" })).toString("base64");
  const fakeFetch = async (url, init) => {
    if (!init.headers["payment-signature"]) {
      challengeCalls++;
      return new Response(null, { status: 402, headers: { "payment-required": challenge(url.includes("a.example") ? "20000" : "90000") } });
    }
    return Response.json({ results: [{ title: "Result", url: "https://result.example", snippet: "Normalized" }] });
  };
  const arbiter = new Arbiter({
    account: "CACCOUNT", sessionSecret: "local-only", fetch: fakeFetch,
    providers: [
      { id: "a", capability: "web.search", endpoint: "https://a.example/search", qualityScore: 0.82 },
      { id: "b", capability: "web.search", endpoint: "https://b.example/search", qualityScore: 0.94 }
    ],
    paymentClient: {
      async loadMandate() { return { asset: "CUSDC", maxPaymentAtomic: 500000n, remainingAtomic: 1000000n, expiresAt: 4102444800, revoked: false }; },
      async authorizeAndSettle() { settlements++; return { payment: { payload: "proof" }, receipt: { transactionHash: "abc" }, remainingAtomic: 980000n }; }
    }
  });
  const request = { executionId: "same", capability: "web.search", input: { query: "q" }, policy: { maxSpendUsdc: "0.05", minimumQuality: 0.8 } };
  const first = await arbiter.execute(request);
  const second = await arbiter.execute(request);
  assert.equal(challengeCalls, 2);
  assert.equal(settlements, 1);
  assert.deepEqual(second, first);
  assert.equal(first.decision.providerId, "a");
  assert.equal(first.output.results[0].snippet, "Normalized");
});

test("router selects lowest economic cost and resolves ties deterministically", () => {
  const winner = selectProvider([
    { providerId: "b", priceAtomic: 100000n, qualityScore: 1, successRate: 1 },
    { providerId: "a", priceAtomic: 20000n, qualityScore: 0.82, successRate: 0.95 }
  ]);
  assert.equal(winner.providerId, "a");
  const tie = selectProvider([
    { providerId: "z", priceAtomic: 1n, qualityScore: 1, successRate: 1 },
    { providerId: "a", priceAtomic: 1n, qualityScore: 1, successRate: 1 }
  ]);
  assert.equal(tie.providerId, "a");
});

test("challenge validation enforces network, asset, policy, and mandate", () => {
  const mandate = { asset: "CUSDC", maxPaymentAtomic: 500000n, remainingAtomic: 1000000n, expiresAt: 4102444800, revoked: false };
  const challenge = { x402Version: 2, scheme: "exact", network: "stellar:testnet", asset: "CUSDC", amount: "20000", payTo: "CDEST" };
  assert.equal(validateChallenge(challenge, mandate, "0.05"), 20000n);
  assert.throws(() => validateChallenge({ ...challenge, network: "base" }, mandate, "0.05"));
  assert.throws(() => validateChallenge({ ...challenge, asset: "WRONG" }, mandate, "0.05"));
  assert.throws(() => validateChallenge({ ...challenge, amount: "500001" }, mandate, "0.05"));
  assert.throws(() => validateChallenge({ ...challenge, payTo: "" }, mandate, "0.05"));
  assert.throws(() => validateChallenge({ ...challenge, payTo: "   " }, mandate, "0.05"));
  assert.throws(() => validateChallenge({ ...challenge, amount: "20.5" }, mandate, "0.05"));
  assert.throws(() => validateChallenge({ ...challenge, amount: "-20000" }, mandate, "0.05"));
});

test("error classes have explicit names", async () => {
  const { NoEligibleProviderError, InvalidPaymentChallengeError } = await import("../dist/index.js");
  assert.equal(new NoEligibleProviderError().name, "NoEligibleProviderError");
  assert.equal(new InvalidPaymentChallengeError().name, "InvalidPaymentChallengeError");
});

test("arbiter constructor rejects duplicate provider IDs and local IP endpoints", () => {
  assert.throws(
    () =>
      new Arbiter({
        account: "CACCOUNT",
        sessionSecret: "sec",
        providers: [
          { id: "p1", capability: "web.search", endpoint: "https://a.example/search", qualityScore: 0.9 },
          { id: "p1", capability: "web.search", endpoint: "https://b.example/search", qualityScore: 0.9 }
        ],
        paymentClient: {}
      }),
    /Duplicate provider id/
  );

  assert.throws(
    () =>
      new Arbiter({
        account: "CACCOUNT",
        sessionSecret: "sec",
        providers: [
          { id: "p1", capability: "web.search", endpoint: "https://[::ffff:127.0.0.1]/search", qualityScore: 0.9 },
          { id: "p2", capability: "web.search", endpoint: "https://b.example/search", qualityScore: 0.9 }
        ],
        paymentClient: {}
      }),
    /Provider endpoints must use a public hostname/
  );
});
