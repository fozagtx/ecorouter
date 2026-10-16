import { describe, expect, it } from "vitest";
import { fmt, parseAmount, usd } from "../lib/money";
import { propose, validate } from "../assistant/intent";
import { evaluate } from "./policy";
import { Rule } from "./rules";
import { CAST, DAY, MONTH, SandboxBackend, memoryStore } from "./sandbox";
import type { Policy } from "./types";

const T0 = 1_800_000_000;

function policy(over: Partial<Policy> = {}): Policy {
  return {
    kind: "person",
    label: "Ada",
    allowance: usd(1_000),
    period: MONTH,
    maxPayment: usd(250),
    maxPayments: 5,
    expiresAt: T0 + 365 * DAY,
    services: ["infer", "data"],
    paused: false,
    anchor: T0,
    ...over,
  };
}

const base = { accountPaused: false, storedUsage: undefined, service: "infer", amount: usd(10), now: T0 };

/** Same cases, same order, same error codes as contracts/team-account/src/test.rs. */
describe("policy mirror of the contract", () => {
  it("passes an in-policy payment", () => {
    expect(evaluate({ ...base, policy: policy() }).ok).toBe(true);
  });
  it.each([
    ["account paused", { accountPaused: true }, Rule.AccountPaused],
    ["unknown spender", { policy: undefined }, Rule.UnknownSpender],
    ["spender paused", { policy: policy({ paused: true }) }, Rule.SpenderPaused],
    ["expired", { policy: policy({ expiresAt: T0 }) }, Rule.PolicyExpired],
    ["zero amount", { amount: 0n }, Rule.InvalidAmount],
    ["off the list", { service: "gpu" }, Rule.ServiceNotAllowed],
    ["reused key", { keyUsed: true }, Rule.DuplicatePayment],
    ["over the cap", { amount: usd(250) + 1n }, Rule.OverPaymentCap],
    ["too many payments", { storedUsage: { periodStart: T0, spent: usd(5), count: 5 } }, Rule.OverFrequency],
    ["over allowance", { storedUsage: { periodStart: T0, spent: usd(1_000), count: 4 }, amount: 1n }, Rule.OverAllowance],
  ])("refuses: %s", (_name, over, rule) => {
    const r = evaluate({ ...base, policy: policy(), ...over } as Parameters<typeof evaluate>[0]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rule).toBe(rule);
  });
  it("allows exactly the cap and exactly the allowance", () => {
    expect(evaluate({ ...base, policy: policy(), amount: usd(250) }).ok).toBe(true);
    expect(evaluate({ ...base, policy: policy(), storedUsage: { periodStart: T0, spent: usd(750), count: 3 }, amount: usd(250) }).ok).toBe(true);
  });
  it("reports how far over the cap a payment is", () => {
    const r = evaluate({ ...base, policy: policy(), amount: usd(420) });
    expect(r.ok === false && r.overBy).toBe(usd(170));
  });
  it("resets usage when the period rolls over", () => {
    const stored = { periodStart: T0, spent: usd(1_000), count: 5 };
    expect(evaluate({ ...base, policy: policy(), storedUsage: stored, now: T0 + MONTH - 1 }).ok).toBe(false);
    expect(evaluate({ ...base, policy: policy(), storedUsage: stored, now: T0 + MONTH }).ok).toBe(true);
  });
});

describe("money", () => {
  it("parses and formats without floats", () => {
    expect(parseAmount("$1,250.50")).toBe(12_505_000_000n);
    expect(parseAmount("0.00000001")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(fmt(usd(1440))).toBe("$1,440.00");
    expect(fmt(1n)).toBe("$0.0000001");
  });
});

describe("sandbox account", () => {
  const make = () => new SandboxBackend(memoryStore(), () => T0);

  it("seeds a team whose history obeys its own rules", async () => {
    const b = make();
    const s = await b.load();
    expect(s.spenders).toHaveLength(4);
    for (const sp of s.spenders) expect(sp.usage.spent <= sp.policy.allowance).toBe(true);
    expect(s.requests.filter((r) => r.status === "pending")).toHaveLength(1);
  });

  it("holds a payment over the cap, then files, approves and settles it as separate steps", async () => {
    const b = make();
    b.actAs(CAST.marcus);
    const r = await b.pay({ spender: CAST.marcus, service: "search", amount: usd(300), memo: "x" });
    expect(r).toMatchObject({ ok: false, rule: Rule.OverPaymentCap, overBy: usd(50) });
    const id = await b.requestApproval({ spender: CAST.marcus, service: "search", amount: usd(300), memo: "x" });
    await expect(b.approve(id)).rejects.toMatchObject({ code: Rule.NotAuthorized });
    b.actAs(CAST.owner);
    const before = (await b.load()).account.balance;
    await b.approve(id);
    expect((await b.load()).account.balance).toBe(before);
    b.actAs(CAST.marcus);
    await b.settle(id);
    const after = await b.load();
    expect(after.account.balance).toBe(before - usd(300));
    expect(after.requests.find((x) => x.id === id)?.status).toBe("settled");
    await expect(b.settle(id)).rejects.toMatchObject({ code: Rule.RequestNotApproved });
  });

  it("refuses a service that is on the list but was never registered", async () => {
    const b = make();
    b.actAs(CAST.marcus);
    const r = await b.pay({ spender: CAST.marcus, service: "translate", amount: usd(10), memo: "x" });
    expect(r.rule).toBe(Rule.UnknownService);
  });

  it("will not let an agent file an approval request", async () => {
    const b = make();
    b.actAs(CAST.scout);
    await expect(b.requestApproval({ spender: CAST.scout, service: "search", amount: usd(100), memo: "x" })).rejects.toMatchObject({ code: Rule.AgentCannotRequest });
  });

  it("runs due agent schedules and records refusals without filing them", async () => {
    let now = T0;
    const b = new SandboxBackend(memoryStore(), () => now);
    now += 5 * 3600;
    expect(await b.runAgents()).toBe(1);
    expect(await b.runAgents()).toBe(0);
    const s = await b.load();
    expect(s.activity[0]).toMatchObject({ kind: "paid", via: "agent", service: "search" });
  });

  it("only the owner can change policies", async () => {
    const b = make();
    b.actAs(CAST.marcus);
    const p = (await b.load()).spenders[1].policy;
    await expect(b.setPolicy(CAST.marcus, { ...p, allowance: usd(5_000) })).rejects.toMatchObject({ code: Rule.NotAuthorized });
  });
});

describe("assistant", () => {
  const registry = [
    { id: "inference", name: "Inference credits", payee: "G1", suspended: false, tags: ["inference", "model", "credits"] },
    { id: "gpu", name: "GPU hours", payee: "G2", suspended: false, tags: ["gpu", "compute"] },
  ];
  const allowed = ["inference", "translate"];

  it("drafts a payment from a sentence", () => {
    const p = propose("Top up our inference credits by $120", allowed, registry);
    expect(p).toMatchObject({ service: "inference", amount: "120" });
    const v = validate(p, allowed, registry);
    expect(v.ok && v.atomic).toBe(usd(120));
  });
  it("refuses an invented recipient at the schema", () => {
    const p = propose("Pay Acme Labs $50 for consulting", allowed, registry);
    expect(p.service).toBe("acme_labs");
    expect(validate(p, allowed, registry).ok).toBe(false);
  });
  it("refuses a registered service that is not on the spender's list", () => {
    const p = propose("Buy GPU hours for $90", allowed, registry);
    const v = validate(p, allowed, registry);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.registeredElsewhere).toBe(true);
  });
});

describe("strkey", () => {
  it("encodes addresses the Stellar SDK accepts, and validates like it", async () => {
    const { StrKey, Keypair } = await import("@stellar/stellar-sdk");
    const { encodeStrKey, isValidStrKey } = await import("../lib/strkey");
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff);
    const g = encodeStrKey("account", bytes);
    const c = encodeStrKey("contract", bytes);
    expect(StrKey.isValidEd25519PublicKey(g)).toBe(true);
    expect(StrKey.isValidContract(c)).toBe(true);
    const real = Keypair.random().publicKey();
    expect(isValidStrKey("account", real)).toBe(true);
    expect(isValidStrKey("account", real.slice(0, -1) + (real.endsWith("A") ? "B" : "A"))).toBe(false);
    expect(isValidStrKey("contract", g)).toBe(false);
  });
});
