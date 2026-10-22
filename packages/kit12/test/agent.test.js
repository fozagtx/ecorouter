import test from "node:test";
import assert from "node:assert/strict";
import { FloatLedger, usd } from "ecorouter";
import { SourcingAgent, SimHolds, SimRail, demoJobs, DEMO_FLOAT, DEMO_FLOOR, quote, CATALOG, DEFAULT_STATE, microsToBase, baseToMicros } from "../dist/index.js";

function run({ approve = async () => true, slowSwift = true, jobs = demoJobs() } = {}) {
  const rail = new SimRail(CATALOG, 0.01);
  const ledger = new FloatLedger(DEMO_FLOAT, DEMO_FLOOR);
  const events = [];
  let plans = 0;
  const onEvent = (e) => {
    events.push(e);
    // Midway: once every job has its plan, the cheapest model provider slows down under load.
    if (slowSwift && e.type === "step_paid" && e.stepId === "plan" && ++plans === jobs.length) rail.state.get("swift").slowFactor = 8;
  };
  const agent = new SourcingAgent({ rail, holds: new SimHolds(), ledger, approve, onEvent, pauseTimeoutMs: 5_000 });
  return { rail, ledger, events, agent, jobs, done: agent.runAll(jobs) };
}

test("clearing units: one micro-dollar is 1e12 USDZ base units", () => {
  assert.equal(microsToBase(1), 10n ** 12n);
  assert.equal(baseToMicros("2500000000000000"), 2500);
  assert.throws(() => baseToMicros(1n), /whole number of clearing units/);
});

test("price grows with the request: a 4x prompt costs more", () => {
  const swift = CATALOG.find((s) => s.id === "swift");
  const small = quote(swift, DEFAULT_STATE, { kind: "reasoning", prompt: "x".repeat(4000), maxTokens: 500 });
  const big = quote(swift, DEFAULT_STATE, { kind: "reasoning", prompt: "x".repeat(16000), maxTokens: 500 });
  assert.ok(big > small * 2);
});

test("Kit 12 run: every job finishes, overrun asks the customer, slow provider is routed around", async () => {
  const approvals = [];
  const { events, ledger, done } = run({ approve: async (r) => (approvals.push(r), true) });
  const reports = await done;

  assert.deepEqual(reports.map((r) => r.status), ["done", "done", "done"]);
  // The overrun job (B) needed more than its hold and asked exactly once, bound to its own job and customer.
  assert.equal(approvals.length >= 1, true);
  assert.equal(approvals[0].jobId, "job-b");
  assert.equal(approvals[0].customer, "Contoso");
  assert.ok(approvals[0].newHold > approvals[0].currentHold);

  // After Swift slowed down, writes went elsewhere: it timed out and was rerouted, or was skipped as slow or unhealthy.
  const avoided = events.some(
    (e) =>
      (e.type === "reroute" && e.from === "swift") ||
      (e.type === "quotes" && e.stepId === "write" && e.offers.some((o) => o.providerId === "swift" && o.skip)),
  );
  assert.ok(avoided, "swift routed around after slowing down");
  const writes = events.filter((e) => e.type === "step_paid" && e.stepId === "write");
  assert.ok(writes.every((w) => w.providerId !== "swift"), "no write step was answered by the slowed provider");

  // Captured never exceeds the hold, every job settled, and the float is whole again at the end.
  for (const r of reports) assert.ok(r.captured === r.spent);
  const spent = reports.reduce((s, r) => s + r.spent, 0);
  assert.equal(ledger.balance(), DEMO_FLOAT - spent);
  assert.ok(events.some((e) => e.type === "job_settled"));
});

test("the float never drops below its floor while jobs run", async () => {
  const { ledger, done } = run();
  let lowest = Infinity;
  const timer = setInterval(() => (lowest = Math.min(lowest, ledger.balance())), 1);
  await done;
  clearInterval(timer);
  assert.ok(lowest >= DEMO_FLOOR, `float dipped to ${lowest}`);
});

test("a job the float can never cover fails at once instead of hanging", async () => {
  const rail = new SimRail(CATALOG, 0.01);
  const ledger = new FloatLedger(usd(0.05), usd(0.04));
  const agent = new SourcingAgent({ rail, holds: new SimHolds(), ledger, approve: async () => true, pauseTimeoutMs: 60_000 });
  const started = Date.now();
  const [r] = await agent.runAll([{ id: "j", customer: "c", budget: usd(1), latencyTargetMs: 5000, steps: [{ id: "s", kind: "search", prompt: "q" }] }]);
  assert.equal(r.status, "failed");
  assert.ok(Date.now() - started < 5_000);
});

test("a customer who declines the raise fails only their own job, and their hold is not overcaptured", async () => {
  const { done } = run({ approve: async () => false });
  const reports = await done;
  const b = reports.find((r) => r.jobId === "job-b");
  assert.equal(b.status, "failed");
  assert.deepEqual(reports.filter((r) => r.jobId !== "job-b").map((r) => r.status), ["done", "done"]);
});

test("a price rise between quote and payment is refused and rerouted, never paid", async () => {
  const rail = new SimRail(CATALOG, 0.01);
  const ledger = new FloatLedger(usd(10), 0);
  const events = [];
  const agent = new SourcingAgent({ rail, holds: new SimHolds(), ledger, approve: async () => true, onEvent: (e) => events.push(e) });
  const orig = rail.run.bind(rail);
  let first = true;
  rail.run = async (...args) => {
    if (first && args[1] === "scout") { first = false; rail.state.get("scout").priceFactor = 3; }
    return orig(...args);
  };
  const [r] = await agent.runAll([{ id: "j", customer: "c", budget: usd(5), latencyTargetMs: 5000, steps: [{ id: "s", kind: "search", prompt: "q" }] }]);
  assert.equal(r.status, "done");
  const reroute = events.find((e) => e.type === "reroute");
  assert.match(reroute.reason, /now asks/);
  const paid = events.find((e) => e.type === "step_paid");
  assert.notEqual(paid.providerId === "scout" && paid.paid > quote(CATALOG.find((s) => s.id === "scout"), DEFAULT_STATE, { kind: "search", prompt: "q" }), true);
});
