#!/usr/bin/env node
// Buy a Metal testnet RPC endpoint with $1 of USDZ credit over x402, paid from the float key.
// Usage: node scripts/metal-rpc-endpoint.mjs <key.json>
// Prints the endpoint URL. The URL is a credential: keep it out of git (put it in .env).
import { readFileSync } from "node:fs";
import { createMetalPaymentClient } from "@metalntwx/metal-pay";
import { privateKeyToAccount } from "viem/accounts";

const keyFile = process.argv[2];
if (!keyFile) {
  console.error("usage: node scripts/metal-rpc-endpoint.mjs <key.json>");
  process.exit(2);
}
const { privateKey } = JSON.parse(readFileSync(keyFile, "utf8"));
const account = privateKeyToAccount(privateKey);
const { fetchWithPayment } = createMetalPaymentClient({ account, network: "testnet" });

const res = await fetchWithPayment("https://rpc-testnet.metalntwx.com/v1", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
});
const endpoint = res.headers.get("rpc-aas-endpoint");
if (!res.ok || !endpoint) {
  console.error(`no endpoint: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(endpoint.startsWith("http") ? endpoint : `https://rpc-testnet.metalntwx.com/v1/${endpoint}`);
