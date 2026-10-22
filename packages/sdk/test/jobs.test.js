import test from "node:test";
import assert from "node:assert/strict";
import { FloatLedger, planRation, usd } from "../dist/index.js";

test("deposits come out of the float and never cross the floor", () => {
  const l = new FloatLedger(usd(10), usd(2));
  l.openJob("a", "acme", usd(5));
  assert.equal(l.free(), usd(8));
  assert.equal(l.deposit("a", usd(5)), true);
  assert.equal(l.free(), usd(3));
  l.openJob("b", "beta", usd(5));
  assert.equal(l.deposit("b", usd(4)), false, "would cross the floor");
  assert.equal(l.deposit("b", usd(3)), true);
  assert.equal(l.free(), 0);
});

test("a job cannot deposit past its hold or spend past its deposit", () => {
  const l = new FloatLedger(usd(100), 0);
  l.openJob("a", "acme", usd(5));
  assert.equal(l.deposit("a", usd(6)), false);
  l.deposit("a", usd(2));
  assert.throws(() => l.spend("a", usd(3)), /past its deposit/);
});

test("settle captures what was spent, releases the rest, returns the unused deposit", () => {
  const l = new FloatLedger(usd(10), usd(1));
  l.openJob("a", "acme", usd(5));
  l.deposit("a", usd(4));
  l.spend("a", usd(2.5));
  assert.deepEqual(l.settle("a"), { jobId: "a", capture: usd(2.5), release: usd(2.5), withdraw: usd(1.5) });
  assert.equal(l.balance(), usd(7.5));
  assert.equal(l.job("a").status, "done");
});

test("rationing: overrun asks the customer for the exact gap, others are funded smallest first", () => {
  const l = new FloatLedger(usd(7), usd(1)); // 5 free after c deposits 1, budgets total 12
  l.openJob("a", "acme", usd(4));
  l.openJob("b", "beta", usd(4));
  l.openJob("c", "core", usd(4));
  l.deposit("c", usd(1));
  l.spend("c", usd(1));

  const plan = planRation(l, [
    { jobId: "a", cheapest: usd(3), preferred: usd(4) },
    { jobId: "b", cheapest: usd(1), preferred: usd(2) },
    { jobId: "c", cheapest: usd(4), preferred: usd(6) }, // overran: 4 needed, 3 left on the hold
  ]);

  assert.deepEqual(plan.find((p) => p.jobId === "c"), {
    jobId: "c", action: "ask_raise_hold", newBudget: usd(5), reason: plan.find((p) => p.jobId === "c").reason,
  });
  const b = plan.find((p) => p.jobId === "b");
  const a = plan.find((p) => p.jobId === "a");
  assert.equal(b.action, "fund");
  assert.equal(b.provider, "preferred", "b can take the better provider and a still fits");
  assert.equal(b.amount, usd(2));
  assert.equal(a.action, "fund");
  assert.equal(a.provider, "cheapest", "only 3 left for a, so cheapest");
  assert.equal(a.amount, usd(3));
});

test("rationing pauses a job the float cannot cover instead of failing it", () => {
  const l = new FloatLedger(usd(3), usd(1)); // 2 free
  l.openJob("a", "acme", usd(5));
  l.openJob("b", "beta", usd(5));
  const plan = planRation(l, [
    { jobId: "a", cheapest: usd(1.5), preferred: usd(1.5) },
    { jobId: "b", cheapest: usd(1.5), preferred: usd(1.5) },
  ]);
  assert.deepEqual(plan.map((p) => p.action), ["fund", "pause"]);
});

test("a raised hold puts a waiting job back to running", () => {
  const l = new FloatLedger(usd(10), 0);
  l.openJob("a", "acme", usd(2));
  l.setStatus("a", "waiting_for_customer");
  l.raiseBudget("a", usd(3));
  assert.equal(l.job("a").status, "running");
  assert.equal(l.budgetLeft("a"), usd(3));
});
