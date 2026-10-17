import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import {
  createGateway,
  isMcpFreeMethod,
  isMcpPaidMethod,
  sep53Message,
  validateUpstreamUrl,
  verifySellerSignature,
} from "../dist/index.js";

const listing = {
  id: "echo_mcp",
  name: "Echo MCP",
  task: "Echo text",
  seller: Keypair.random().publicKey(),
  kind: "mcp",
  payee: Keypair.random().publicKey(),
  url: "http://localhost:8787/a/echo_mcp",
  price: 50_000n,
  suspended: false,
};

test("verifies SEP-53 signatures over the upstream registration message", () => {
  const seller = Keypair.random();
  const message = "ecorouter:upstream:echo_mcp:abc:1792193064";
  const signature = Buffer.from(seller.sign(sep53Message(message))).toString("base64");
  assert.equal(verifySellerSignature(seller.publicKey(), signature, message), true);
  assert.equal(verifySellerSignature(seller.publicKey(), signature, `${message}:changed`), false);
});

test("rejects production private and link-local upstream addresses", async () => {
  await assert.rejects(validateUpstreamUrl("https://10.0.0.8/api", true));
  await assert.rejects(validateUpstreamUrl("https://agent.example/api", true, async () => ["169.254.169.254"]));
  await assert.rejects(validateUpstreamUrl("http://localhost:9000", true));
  assert.equal((await validateUpstreamUrl("http://localhost:9000", false)).hostname, "localhost");
});

test("splits free MCP discovery from paid tool calls", () => {
  for (const method of ["initialize", "notifications/initialized", "tools/list", "resources/list", "prompts/list"]) {
    assert.equal(isMcpFreeMethod({ method }), true);
    assert.equal(isMcpPaidMethod({ method }), false);
  }
  assert.equal(isMcpPaidMethod({ method: "tools/call" }), true);
  assert.equal(isMcpFreeMethod({ method: "tools/call" }), false);
});

test("returns 503 for a disconnected listing before issuing a 402", async (t) => {
  const app = createGateway({
    listings: { list: async () => [listing], get: async (id) => id === listing.id ? listing : null },
    upstreams: { initialize: async () => {}, get: async () => null, listConnected: async () => new Set(), put: async () => {} },
    facilitatorUrl: "https://www.x402.org/facilitator",
    usdc: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    publicUrl: "http://localhost:8787",
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/a/echo_mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "shout", arguments: {} } }),
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.has("PAYMENT-REQUIRED"), false);
});

test("rejects an invalid seller signature on upstream registration", async (t) => {
  const app = createGateway({
    listings: { list: async () => [listing], get: async (id) => id === listing.id ? listing : null },
    upstreams: { initialize: async () => {}, get: async () => null, listConnected: async () => new Set(), put: async () => {} },
    facilitatorUrl: "https://www.x402.org/facilitator",
    usdc: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    publicUrl: "http://localhost:8787",
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const body = JSON.stringify({ url: "http://localhost:9000", kind: "mcp" });
  const response = await fetch(`http://127.0.0.1:${address.port}/listings/${listing.id}/upstream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Stellar-Address": listing.seller,
      "X-Stellar-Signature": Buffer.alloc(64).toString("base64"),
      "X-Timestamp": String(Math.floor(Date.now() / 1000)),
    },
    body,
  });
  assert.equal(response.status, 401);
});
