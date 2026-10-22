import test from "node:test";
import assert from "node:assert/strict";
import {
  CapLedger,
  HealthTracker,
  OpenRouterPrices,
  Router,
  RouteRefused,
  StaticPrices,
  contextDev,
  estimateCost,
  exa,
  firecrawl,
  usd,
} from "../dist/index.js";

// A provider that answers locally, for exercising the router without network calls.
function local(id, kinds, opts = {}) {
  return {
    id,
    name: id,
    kinds,
    frontier: opts.frontier,
    calls: 0,
    async call() {
      this.calls += 1;
      if (opts.fail) throw new Error(`${id} is down`);
      return { output: { text: `from ${id}` }, usage: opts.usage ?? {} };
    },
  };
}

const perRequest = (n) => ({ price: { unit: "request", usd: n }, source: "test sheet" });

function setup({ providers, prices, policy = {} }) {
  const caps = new CapLedger();
  caps.setPolicy({
    agentId: "a",
    periodCap: usd(1),
    period: "day",
    stepCeiling: usd(0.05),
    kinds: ["reasoning", "search", "scrape"],
    providers: [],
    ...policy,
  });
  const router = new Router({ prices: new StaticPrices(prices), caps, providers });
  return { router, caps };
}

test("picks the cheapest provider that fits", async () => {
  const { router } = setup({
    providers: [local("exa", ["search"]), local("tavily", ["search"])],
    prices: { exa: perRequest(0.005), tavily: perRequest(0.008) },
  });
  const d = await router.route("a", { kind: "search", query: "q" });
  assert.equal(d.picked, "exa");
  assert.equal(d.refusal, null);
});

test("ties go to the faster provider", async () => {
  const { router } = setup({
    providers: [local("slow", ["search"]), local("fast", ["search"])],
    prices: { slow: perRequest(0.005), fast: perRequest(0.005) },
  });
  router.health.seed("slow", 900);
  router.health.seed("fast", 200);
  assert.equal((await router.route("a", { kind: "search", query: "q" })).picked, "fast");
});

test("each candidate carries the reason it was skipped", async () => {
  const { router } = setup({
    providers: [
      local("blocked", ["search"]),
      local("pricey", ["search"]),
      local("slow", ["search"]),
      local("unpriced", ["search"]),
      local("ok", ["search"]),
    ],
    prices: { blocked: perRequest(0.001), pricey: perRequest(0.06), slow: perRequest(0.002), ok: perRequest(0.004) },
    policy: { providers: ["pricey", "slow", "unpriced", "ok"] },
  });
  router.health.seed("slow", 5000);
  const d = await router.route("a", { kind: "search", query: "q" }, { latencyTargetMs: 2000 });
  const why = Object.fromEntries(d.candidates.map((c) => [c.providerId, c.skip]));
  assert.deepEqual(why, { blocked: "not_allowed", pricey: "over_step_ceiling", slow: "too_slow", unpriced: "no_price", ok: null });
  assert.equal(d.picked, "ok");
});

test("frontier steps skip non-frontier models", async () => {
  const { router } = setup({
    providers: [local("cheap", ["reasoning"]), local("big", ["reasoning"], { frontier: true })],
    prices: {
      cheap: { price: { unit: "token", inputPerMTok: 0.1, outputPerMTok: 0.1 }, source: "t" },
      big: { price: { unit: "token", inputPerMTok: 3, outputPerMTok: 15 }, source: "t" },
    },
  });
  const d = await router.route("a", { kind: "reasoning", prompt: "hi", frontier: true, maxOutputTokens: 100 });
  assert.equal(d.picked, "big");
  assert.equal(d.candidates.find((c) => c.providerId === "cheap").skip, "not_frontier");
});

test("refuses unknown, paused, and disallowed agents before pricing anything", async () => {
  const { router, caps } = setup({
    providers: [local("exa", ["search"])],
    prices: { exa: perRequest(0.005) },
    policy: { kinds: ["search"] },
  });
  assert.equal((await router.route("nobody", { kind: "search", query: "q" })).refusal, "agent_unknown");
  assert.equal((await router.route("a", { kind: "scrape", url: "https://x" })).refusal, "kind_not_allowed");
  caps.pause("a");
  assert.equal((await router.route("a", { kind: "search", query: "q" })).refusal, "agent_paused");
});

test("run budget reroutes to a cheaper provider, then stops when nothing fits", async () => {
  const { router, caps } = setup({
    providers: [local("big", ["search"]), local("small", ["search"])],
    prices: { big: perRequest(0.01), small: perRequest(0.004) },
  });
  caps.openRun("r1", usd(0.012));
  let d = await router.route("a", { kind: "search", query: "q" }, { runId: "r1" });
  assert.equal(d.picked, "small");

  await router.run("a", { kind: "search", query: "q" }, { runId: "r1" });
  await router.run("a", { kind: "search", query: "q" }, { runId: "r1" });
  assert.equal(caps.runLeft("r1"), usd(0.004));
  await router.run("a", { kind: "search", query: "q" }, { runId: "r1" });
  assert.equal(caps.runLeft("r1"), 0);

  d = await router.route("a", { kind: "search", query: "q" }, { runId: "r1" });
  assert.equal(d.refusal, "nothing_fits");
  await assert.rejects(router.run("a", { kind: "search", query: "q" }, { runId: "r1" }), RouteRefused);
});

test("a failing provider is rerouted around and recorded on the receipt", async () => {
  const down = local("cheap", ["scrape"], { fail: true });
  const up = local("backup", ["scrape"]);
  const { router, caps } = setup({ providers: [down, up], prices: { cheap: perRequest(0.002), backup: perRequest(0.003) } });
  const { receipt, output } = await router.run("a", { kind: "scrape", url: "https://example.com" });
  assert.equal(output.text, "from backup");
  assert.equal(receipt.providerId, "backup");
  assert.deepEqual(receipt.attempts, [{ providerId: "cheap", error: "cheap is down" }]);
  assert.equal(caps.periodLeft("a"), usd(1) - usd(0.003), "the failed call is released, only the real call is spent");
});

test("the provider's reported cost replaces the estimate", async () => {
  const { router, caps } = setup({
    providers: [local("exa", ["search"], { usage: { reportedCost: usd(0.0035) } })],
    prices: { exa: perRequest(0.005) },
  });
  const { receipt } = await router.run("a", { kind: "search", query: "q" });
  assert.equal(receipt.cost, usd(0.0035));
  assert.equal(receipt.costSource, "provider");
  assert.equal(caps.periodLeft("a"), usd(1) - usd(0.0035));
});

test("credit-priced providers settle on credits actually consumed", async () => {
  const { router } = setup({
    providers: [local("contextdev", ["scrape"], { usage: { credits: 2 } })],
    prices: { contextdev: { price: { unit: "credit", usdPerCredit: 0.0022, creditsPerCall: 1 }, source: "t" } },
  });
  const { receipt } = await router.run("a", { kind: "scrape", url: "https://x" });
  assert.equal(receipt.estimate, usd(0.0022));
  assert.equal(receipt.cost, usd(0.0044));
});

test("period cap holds across steps and counts money reserved for calls in flight", () => {
  const caps = new CapLedger();
  caps.setPolicy({ agentId: "a", periodCap: usd(0.01), period: "day", stepCeiling: usd(0.01), kinds: ["search"], providers: [] });
  const h1 = caps.reserve("a", usd(0.006));
  assert.ok(h1);
  assert.equal(caps.reserve("a", usd(0.006)), null, "second concurrent step cannot take the same money");
  caps.settle(h1, usd(0.004));
  assert.equal(caps.periodLeft("a"), usd(0.006));
});

test("period window resets after the period", () => {
  let now = 0;
  const caps = new CapLedger(() => now);
  caps.setPolicy({ agentId: "a", periodCap: usd(0.01), period: "day", stepCeiling: usd(0.01), kinds: ["search"], providers: [] });
  caps.settle(caps.reserve("a", usd(0.01)), usd(0.01));
  assert.equal(caps.periodLeft("a"), 0);
  now = 86_400_000;
  assert.equal(caps.periodLeft("a"), usd(0.01));
});

test("circuit breaker takes a provider out after repeated failures", () => {
  let now = 0;
  const h = new HealthTracker({ maxFailures: 3, cooldownMs: 1000, now: () => now });
  h.failure("x"); h.failure("x");
  assert.equal(h.healthy("x"), true);
  h.failure("x");
  assert.equal(h.healthy("x"), false);
  now = 1000;
  assert.equal(h.healthy("x"), true);
});

test("token estimate covers prompt and max output", () => {
  const price = { unit: "token", inputPerMTok: 3, outputPerMTok: 15 };
  // 400 chars ≈ 100 tokens in, 1000 tokens out: 100*3/1e6 + 1000*15/1e6 = 0.0153
  assert.equal(estimateCost(price, { kind: "reasoning", prompt: "x".repeat(400), maxOutputTokens: 1000 }), usd(0.0153));
});

test("OpenRouter prices are read live from its model list", async () => {
  const fake = async () => new Response(JSON.stringify({ data: [{ id: "acme/model", pricing: { prompt: "0.000002", completion: "0.000008" } }] }));
  const q = await new OpenRouterPrices({ fetch: fake }).quote("openrouter:acme/model");
  assert.deepEqual(q.price, { unit: "token", inputPerMTok: 2, outputPerMTok: 8 });
  assert.equal(await new OpenRouterPrices({ fetch: fake }).quote("exa"), null);
});

function recordingFetch(response) {
  const seen = [];
  const f = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(response));
  };
  return { f, seen };
}

test("adapters send the documented request shapes", async () => {
  const signal = new AbortController().signal;

  const c = recordingFetch({ markdown: { success: true, data: "# hi" }, key_metadata: { credits_consumed: 1 } });
  const r1 = await contextDev({ apiKey: "k", fetch: c.f }).call({ kind: "scrape", url: "https://example.com" }, signal);
  assert.equal(c.seen[0].url, "https://api.context.dev/v1/web/scrape");
  assert.equal(c.seen[0].headers.authorization, "Bearer k");
  assert.deepEqual(c.seen[0].body.formats, { markdown: true });
  assert.equal(r1.usage.credits, 1);

  const fc = recordingFetch({ success: true, data: { markdown: "# hi", metadata: { creditsUsed: 1 } } });
  await firecrawl({ apiKey: "k", fetch: fc.f }).call({ kind: "scrape", url: "https://example.com" }, signal);
  assert.equal(fc.seen[0].url, "https://api.firecrawl.dev/v1/scrape");
  assert.deepEqual(fc.seen[0].body.formats, ["markdown"]);

  const e = recordingFetch({ results: [{ title: "T", url: "https://t" }], costDollars: { total: 0.005 } });
  const r3 = await exa({ apiKey: "k", fetch: e.f }).call({ kind: "search", query: "q" }, signal);
  assert.equal(e.seen[0].headers["x-api-key"], "k");
  assert.equal(r3.usage.reportedCost, usd(0.005));
});

test("adapters fail clearly when a key is missing", async () => {
  await assert.rejects(exa({ apiKey: undefined }).call({ kind: "search", query: "q" }, new AbortController().signal), /EXA_API_KEY is not set/);
});
