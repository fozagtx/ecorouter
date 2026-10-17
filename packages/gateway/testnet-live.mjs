import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { Address, Account, Asset, Horizon, Keypair, Networks, Operation, StrKey, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { decodePaymentResponseHeader } from "@x402/core/http";
import express from "express";
import { z } from "zod";
import deployment from "../../deployments/testnet.json" with { type: "json" };
import { TeamAgent } from "../sdk/dist/index.js";
import { sep53Message } from "./dist/index.js";

const root = resolve(import.meta.dirname, "../..");
const gateway = process.env.GATEWAY_URL ?? "http://127.0.0.1:8787";
const owner = Keypair.fromSecret(process.env.OWNER_SECRET ?? await readFile("/home/ubuntu/.ecorouter-owner-secret", "utf8").then((value) => value.trim()));
const keys = JSON.parse(await readFile(resolve(root, ".deploy/testnet-keys.json"), "utf8"));
const rpcServer = new rpc.Server(deployment.rpcUrl);
const networkPassphrase = Networks.TESTNET;
const usdcIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const usdc = new Asset("USDC", usdcIssuer).contractId(networkPassphrase);
const maximumFee = 500_000_000n;

async function readContract(contractId, method, ...args) {
  const tx = new TransactionBuilder(new Account(Keypair.random().publicKey(), "0"), {
    fee: "100", networkPassphrase,
  }).addOperation(new (await import("@stellar/stellar-sdk")).Contract(contractId).call(method, ...args)).setTimeout(30).build();
  const simulated = await rpcServer.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(simulated)) throw new Error(`${method} simulation failed: ${JSON.stringify(simulated)}`);
  return scValToNative(simulated.result.retval);
}

async function setPolicy(buyer, maxPayment) {
  const fields = [
    ["allowance", nativeToScVal(2_000_000n, { type: "i128" })],
    ["expires_at", nativeToScVal(BigInt(Math.floor(Date.now() / 1000) + 90 * 86400), { type: "u64" })],
    ["kind", nativeToScVal(1, { type: "u32" })],
    ["label", nativeToScVal("gateway test buyer", { type: "string" })],
    ["max_payment", nativeToScVal(maxPayment, { type: "i128" })],
    ["max_payments", nativeToScVal(10, { type: "u32" })],
    ["period", nativeToScVal(2_592_000n, { type: "u64" })],
    ["services", xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("nebius_llm"), xdr.ScVal.scvSymbol("echo_mcp")])],
    ["signer", xdr.ScVal.scvBytes(StrKey.decodeEd25519PublicKey(buyer.publicKey()))],
  ].map(([key, value]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: value }));
  const transaction = new TransactionBuilder(await rpcServer.getAccount(owner.publicKey()), { fee: "100", networkPassphrase })
    .addOperation(new (await import("@stellar/stellar-sdk")).Contract(deployment.teamAccount.contractId)
      .call("set_policy", new Address(buyer.publicKey()).toScVal(), xdr.ScVal.scvMap(fields)))
    .setTimeout(120).build();
  const simulation = await rpcServer.simulateTransaction(transaction);
  if (!rpc.Api.isSimulationSuccess(simulation)) throw new Error(`set_policy simulation failed: ${JSON.stringify(simulation)}`);
  const resourceFee = BigInt(simulation.minResourceFee ?? "0");
  console.log(`set_policy simulated fee=${resourceFee} stroops`);
  if (resourceFee > maximumFee) throw new Error(`set_policy exceeds 50 XLM (${resourceFee} stroops)`);
  const prepared = rpc.assembleTransaction(transaction, simulation).build();
  prepared.sign(owner);
  const sent = await rpcServer.sendTransaction(prepared);
  if (sent.status !== "PENDING") throw new Error(`set_policy rejected: ${sent.errorResult?.toXDR("base64")}`);
  const done = await rpcServer.pollTransaction(sent.hash, { attempts: 40 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`set_policy failed: ${done.status}`);
  console.log(`set_policy tx=${sent.hash} fee=${done.feeCharged ?? prepared.fee} stroops`);
}

async function startEchoServer() {
  const sessions = new Map();
  const app = express();
  app.use(express.json());
  app.post("/", async (req, res) => {
    const sessionId = req.get("Mcp-Session-Id");
    if (sessionId) {
      const transport = sessions.get(sessionId);
      if (!transport) return res.status(404).json({ error: "Unknown MCP session" });
      return transport.handleRequest(req, res, req.body);
    }
    if (req.body?.method !== "initialize") return res.status(400).json({ error: "MCP session must be initialized" });
    const mcp = new McpServer({ name: "ecorouter-echo", version: "1.0.0" });
    mcp.registerTool("shout", {
      description: "Return the input text in uppercase",
      inputSchema: { text: z.string() },
    }, async ({ text }) => ({ content: [{ type: "text", text: text.toUpperCase() }] }));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => sessions.set(id, transport),
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await mcp.connect(transport);
    return transport.handleRequest(req, res, req.body);
  });
  const server = createServer(app);
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function decodeMcp(response) {
  return response.text().then((text) => {
    const data = text.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
    return JSON.parse(data ?? text);
  });
}

function close(server) {
  return new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

async function registerEchoUpstream(seller, url) {
  const body = JSON.stringify({ url, kind: "mcp" });
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const message = `ecorouter:upstream:echo_mcp:${bodyHash}:${timestamp}`;
  const response = await fetch(`${gateway}/listings/echo_mcp/upstream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Stellar-Address": seller.publicKey(),
      "X-Stellar-Signature": Buffer.from(seller.sign(sep53Message(message))).toString("base64"),
      "X-Timestamp": String(timestamp),
    },
    body,
  });
  if (response.status !== 204) throw new Error(`echo upstream registration failed ${response.status}: ${await response.text()}`);
}

async function settlement(response) {
  const header = response.headers.get("PAYMENT-RESPONSE");
  if (!header) return null;
  const payment = decodePaymentResponseHeader(header);
  const transaction = await rpcServer.getTransaction(payment.transaction);
  return { ...payment, feeCharged: transaction.feeCharged, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${payment.transaction}` };
}

async function main() {
  if (!await fetch(`${gateway}/health`).then((response) => response.ok)) throw new Error("Gateway health check failed");
  const buyer = Keypair.random();
  const funded = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(buyer.publicKey())}`);
  if (!funded.ok) throw new Error(`Friendbot failed: ${funded.status}`);
  await setPolicy(buyer, 100_000n);
  const agent = new TeamAgent({
    secret: buyer.secret(),
    teamAccount: deployment.teamAccount.contractId,
    registry: deployment.registry.contractId,
    rpcUrl: deployment.rpcUrl,
    networkPassphrase: deployment.networkPassphrase,
  });
  const echo = await startEchoServer();
  try {
    const echoSeller = Keypair.fromSecret(keys.echoSeller);
    const mcpUrl = `${gateway}/a/echo_mcp`;
    const disconnected = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list" }),
    });
    if (disconnected.status !== 503 || disconnected.headers.has("PAYMENT-REQUIRED")) {
      throw new Error(`Disconnected listing did not return 503 before payment: ${disconnected.status}`);
    }
    console.log("disconnected listing: 503 before payment");

    const badSignatureBody = JSON.stringify({ url: echo.url, kind: "mcp" });
    const badSignatureTimestamp = Math.floor(Date.now() / 1000);
    const badSignature = await fetch(`${gateway}/listings/echo_mcp/upstream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Stellar-Address": echoSeller.publicKey(),
        "X-Stellar-Signature": Buffer.from("invalid").toString("base64"),
        "X-Timestamp": String(badSignatureTimestamp),
      },
      body: badSignatureBody,
    });
    if (badSignature.status !== 401) {
      throw new Error(`Invalid upstream signature returned ${badSignature.status}: ${await badSignature.text()}`);
    }
    console.log("bad upstream signature: 401");
    await registerEchoUpstream(echoSeller, echo.url);

    const nebiusPayee = Keypair.fromSecret(keys.payee).publicKey();
    const echoPayee = Keypair.fromSecret(keys.echoPayee).publicKey();
    const before = {
      team: BigInt(await readContract(usdc, "balance", new Address(deployment.teamAccount.contractId).toScVal())),
      nebius: BigInt(await readContract(usdc, "balance", new Address(nebiusPayee).toScVal())),
      echo: BigInt(await readContract(usdc, "balance", new Address(echoPayee).toScVal())),
    };

    const api = await agent.fetch(`${gateway}/a/nebius_llm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "In one short sentence, what is 2 + 2?", max_tokens: 64 }),
    });
    const apiBody = await api.response.json();
    const apiSettlement = await settlement(api.response);
    if (api.response.status !== 200 || !apiSettlement?.success) {
      throw new Error(`Nebius payment failed: status=${api.response.status} rule=${api.rule ?? "none"} payment=${JSON.stringify(api.payment)} payment-required=${api.response.headers.get("PAYMENT-REQUIRED")} payment-response=${api.response.headers.get("PAYMENT-RESPONSE")} body=${JSON.stringify(apiBody)}`);
    }
    console.log(`API simulated x402 fee=${api.resourceFeeStroops} stroops`);
    console.log(`API output: ${JSON.stringify(apiBody.output).slice(0, 160)}`);
    console.log(`API settlement: ${JSON.stringify(apiSettlement)}`);

    const initialize = await fetch(mcpUrl, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
    });
    const session = initialize.headers.get("Mcp-Session-Id");
    if (!initialize.ok || !session) {
      throw new Error(`MCP initialize failed: HTTP ${initialize.status} ${await initialize.text()}`);
    }
    const list = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(session ? { "Mcp-Session-Id": session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const listed = await decodeMcp(list);
    if (!list.ok || list.headers.has("PAYMENT-REQUIRED") || !listed.result?.tools?.some((tool) => tool.name === "shout")) {
      throw new Error(`MCP tools/list was not a free successful request: ${JSON.stringify(listed)}`);
    }
    console.log("MCP tools/list: free; shout discovered");

    const call = await agent.mcpCall(mcpUrl, "shout", { text: "hi" });
    const callBody = await decodeMcp(call.response);
    const mcpSettlement = await settlement(call.response);
    if (call.response.status !== 200 || !mcpSettlement?.success ||
        !callBody.result?.content?.some((item) => item.text === "HI")) {
      throw new Error(`MCP tools/call failed: ${JSON.stringify(callBody)}`);
    }
    console.log(`MCP tools/call simulated x402 fee=${call.resourceFeeStroops} stroops`);
    console.log(`MCP tools/call: ${JSON.stringify(callBody.result.content)} settlement=${JSON.stringify(mcpSettlement)}`);

    const afterPaid = {
      team: BigInt(await readContract(usdc, "balance", new Address(deployment.teamAccount.contractId).toScVal())),
      nebius: BigInt(await readContract(usdc, "balance", new Address(nebiusPayee).toScVal())),
      echo: BigInt(await readContract(usdc, "balance", new Address(echoPayee).toScVal())),
    };
    console.log(`paid balance deltas team=${afterPaid.team - before.team} nebius=${afterPaid.nebius - before.nebius} echo=${afterPaid.echo - before.echo} stroops`);
    console.log(`usage after payment: ${JSON.stringify(await agent.usage(), (_key, value) => typeof value === "bigint" ? value.toString() : value)}`);

    await setPolicy(buyer, 49_999n);
    const refused = await agent.mcpCall(mcpUrl, "shout", { text: "must not settle" });
    const refusalBody = await decodeMcp(refused.response);
    const afterRefusal = {
      team: BigInt(await readContract(usdc, "balance", new Address(deployment.teamAccount.contractId).toScVal())),
      echo: BigInt(await readContract(usdc, "balance", new Address(echoPayee).toScVal())),
    };
    if (refused.response.status !== 402 || refused.rule !== 8 || refused.payment !== null ||
        afterRefusal.team !== afterPaid.team || afterRefusal.echo !== afterPaid.echo) {
      throw new Error(`Over-cap request was not refused before signing: ${JSON.stringify(refusalBody)}`);
    }
    console.log(`over-cap refusal rule=${refused.rule}; no balance movement; response=${JSON.stringify(refusalBody).slice(0, 200)}`);
  } finally {
    await close(echo.server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
