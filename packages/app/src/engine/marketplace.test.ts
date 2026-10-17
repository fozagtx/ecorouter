import { describe, expect, it } from "vitest";
import { mapRegistryListing, isListingIdValid, listingValidationError, mapX402Transfers } from "./marketplace";
import type { Service } from "./types";

const listing: Service = {
  id: "nebius_llm",
  name: "Nebius LLM",
  seller: "GSELLER",
  kind: "api",
  task: "Real model inference",
  payee: "GPAYEE",
  url: "https://gateway.example/a/nebius_llm",
  price: 100_000n,
  suspended: false,
};

describe("marketplace data", () => {
  it("maps v2 registry listings without inventing metadata", () => {
    expect(mapRegistryListing({
      id: "nebius_llm",
      name: "Nebius LLM",
      seller: "GSELLER",
      kind: "api",
      task: "Real model inference",
      payee: "GPAYEE",
      url: "https://gateway.example/a/nebius_llm",
      price: "100000",
      suspended: false,
    })).toEqual(listing);
  });

  it("validates a contract-sized symbol and a UTF-8 byte-limited task", () => {
    expect(isListingIdValid("echo_mcp")).toBe(true);
    expect(isListingIdValid("tool-name")).toBe(false);
    expect(isListingIdValid("ten_chars_")).toBe(false);
    expect(listingValidationError({ id: "echo_mcp", name: "Echo", task: "é".repeat(141), price: 50_000n })).toContain("280 bytes");
    expect(listingValidationError({ id: "echo_mcp", name: "Echo", task: "Echoes text", price: 50_000n })).toBeNull();
  });

  it("maps only new team-account transfers to registered payees as x402 payments", () => {
    const payments = mapX402Transfers([
      { id: "a", txHash: "tx-a", at: 100, from: "CTEAM", to: "GPAYEE", amount: 100_000n },
      { id: "b", txHash: "tx-b", at: 101, from: "GOTHER", to: "GPAYEE", amount: 100_000n },
      { id: "c", txHash: "tx-c", at: 102, from: "CTEAM", to: "GUNKNOWN", amount: 100_000n },
      { id: "d", txHash: "tx-d", at: 103, from: "CTEAM", to: "GPAYEE", amount: 100_000n },
    ], "CTEAM", [listing], [{ id: "existing", kind: "paid", at: 99, txHash: "tx-d" }]);

    expect(payments).toEqual([{
      id: "x402-a",
      kind: "paid",
      at: 100,
      service: "nebius_llm",
      amount: 100_000n,
      txHash: "tx-a",
      via: "x402",
      note: "GPAYEE",
    }]);
  });
});
