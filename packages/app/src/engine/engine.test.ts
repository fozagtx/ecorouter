import { describe, expect, it } from "vitest";
import { fmt, parseAmount, usd } from "../lib/money";
import { propose, validate } from "../assistant/intent";

describe("money", () => {
  it("parses and formats without floats", () => {
    expect(parseAmount("$1,250.50")).toBe(12_505_000_000n);
    expect(parseAmount("0.00000001")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(fmt(usd(1440))).toBe("$1,440.00");
    expect(fmt(1n)).toBe("$0.0000001");
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
