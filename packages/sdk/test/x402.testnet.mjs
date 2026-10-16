import { once } from "node:events";
import { createServer } from "node:http";
import {
  Address,
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc as stellarRpc,
  xdr,
} from "@stellar/stellar-sdk";
import express from "express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { x402Facilitator } from "@x402/core/facilitator";
import { paymentMiddleware } from "@x402/express";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme as ExactStellarServer } from "@x402/stellar/exact/server";
import { ExactStellarScheme as ExactStellarFacilitator } from "@x402/stellar/exact/facilitator";
import { payX402 } from "../dist/x402.js";

const TESTNET_RPC = "https://soroban-testnet.stellar.org";
const FACILITATOR_URL = "https://www.x402.org/facilitator";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const AMOUNT = 100_000n;
const MAX_POLICY_FEE_STROOPS = 500_000_000n;

if (process.env.ECOROUTER_LIVE !== "1") {
  console.log("SKIP x402 testnet spike (set ECOROUTER_LIVE=1)");
  process.exit(0);
}

const ownerSecret = process.env.OWNER_SECRET;
if (!ownerSecret) throw new Error("OWNER_SECRET is required when ECOROUTER_LIVE=1");

const root = new URL("../../../", import.meta.url);
const deployment = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("deployments/testnet.json", root), "utf8"));
const keyPath = new URL(".deploy/testnet-keys.json", root);
const keys = JSON.parse(await (await import("node:fs/promises")).readFile(keyPath, "utf8"));
const owner = Keypair.fromSecret(ownerSecret);
const payee = Keypair.fromSecret(keys.payee);
const teamAccount = deployment.teamAccount.contractId;
const rpc = new stellarRpc.Server(TESTNET_RPC);
const networkPassphrase = Networks.TESTNET;

async function read(contractId, method, ...args) {
  const { Contract, TransactionBuilder, Account, scValToNative } = await import("@stellar/stellar-sdk");
  const tx = new TransactionBuilder(new Account(owner.publicKey(), "0"), {
    fee: "100",
    networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  if (!stellarRpc.Api.isSimulationSuccess(sim)) throw new Error(`Read ${method} failed: ${JSON.stringify(sim)}`);
  return scValToNative(sim.result.retval);
}

async function setBuyerPolicy(buyer, maxPayment) {
  const { StrKey, xdr: stellarXdr, Address, nativeToScVal, Contract, TransactionBuilder, Account } = await import("@stellar/stellar-sdk");
  const entries = [
    ["allowance", nativeToScVal(BigInt(maxPayment) > AMOUNT ? BigInt(maxPayment) : AMOUNT, { type: "i128" })],
    ["expires_at", nativeToScVal(BigInt(Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60), { type: "u64" })],
    ["kind", nativeToScVal(1, { type: "u32" })],
    ["label", nativeToScVal("x402 spike buyer", { type: "string" })],
    ["max_payment", nativeToScVal(BigInt(maxPayment), { type: "i128" })],
    ["max_payments", nativeToScVal(5, { type: "u32" })],
    ["period", nativeToScVal(2_592_000n, { type: "u64" })],
    ["services", xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("nebius_llm")])],
    ["signer", xdr.ScVal.scvBytes(StrKey.decodeEd25519PublicKey(buyer.publicKey()))],
  ].map(([key, val]) => new stellarXdr.ScMapEntry({ key: stellarXdr.ScVal.scvSymbol(key), val }));
  const input = stellarXdr.ScVal.scvMap(entries);
  const tx = new TransactionBuilder(await rpc.getAccount(owner.publicKey()), {
    fee: "100",
    networkPassphrase,
  })
    .addOperation(new Contract(teamAccount).call("set_policy", new Address(buyer.publicKey()).toScVal(), input))
    .setTimeout(120)
    .build();
  const simulation = await rpc.simulateTransaction(tx);
  if (!stellarRpc.Api.isSimulationSuccess(simulation)) {
    throw new Error(`set_policy simulation failed: ${JSON.stringify(simulation)}`);
  }
  const simulatedFee = BigInt(simulation.minResourceFee);
  console.log(`set_policy simulation breakdown: ${JSON.stringify({
    minResourceFee: simulatedFee.toString(),
    transactionData: simulation.transactionData,
  })}`);
  if (simulatedFee > MAX_POLICY_FEE_STROOPS) {
    throw new Error(`set_policy simulation exceeds 50 XLM; transaction was not submitted (${simulatedFee} stroops)`);
  }
  const prepared = rpc.assembleTransaction(tx, simulation).build();
  prepared.sign(owner);
  const sent = await rpc.sendTransaction(prepared);
  if (sent.status !== "PENDING") throw new Error(`set_policy submit failed: ${JSON.stringify(sent)}`);
  const done = await rpc.pollTransaction(sent.hash, { attempts: 40 });
  if (done.status !== "SUCCESS") throw new Error(`set_policy failed: ${done.status} (${sent.hash})`);
  console.log(`set_policy max=${maxPayment} tx=${sent.hash} fee=${done.feeCharged} stroops`);
  return sent.hash;
}

async function friendbot(pair) {
  const response = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(pair.publicKey())}`);
  if (!response.ok) throw new Error(`Friendbot failed for ${pair.publicKey()}: ${response.status} ${await response.text()}`);
}

async function createBuyerTrustline() {
  const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
  const source = await horizon.loadAccount(owner.publicKey());
  const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase })
    .addOperation(Operation.changeTrust({ asset: new Asset("USDC", USDC_ISSUER) }))
    .setTimeout(120)
    .build();
  tx.sign(owner);
  const result = await horizon.submitTransaction(tx);
  console.log(`buyer trustline tx=${result.hash}`);
}

async function startSeller(facilitatorUrl) {
  const nebiusApiKey = process.env.NEBIUS_API_KEY;
  if (!nebiusApiKey) throw new Error("NEBIUS_API_KEY is required by the seller server");
  class ReportingFacilitator extends HTTPFacilitatorClient {
    async verify(payload, requirements) {
      try {
        const result = await super.verify(payload, requirements);
        console.log(`facilitator verify response: ${JSON.stringify(result)}`);
        return result;
      } catch (error) {
        console.log(`facilitator verify error: ${String(error)}`);
        throw error;
      }
    }

    async settle(payload, requirements) {
      try {
        const result = await super.settle(payload, requirements);
        console.log(`facilitator settle response: ${JSON.stringify(result)}`);
        return result;
      } catch (error) {
        console.log(`facilitator settle error: ${String(error)}`);
        throw error;
      }
    }
  }
  const facilitator = new ReportingFacilitator({ url: facilitatorUrl });
  const server = new x402ResourceServer(facilitator).register(
    "stellar:testnet",
    new ExactStellarServer(),
  );
  const app = express();
  app.use(
    paymentMiddleware(
      {
        "GET /infer": {
          accepts: {
            scheme: "exact",
            network: "stellar:testnet",
            payTo: payee.publicKey(),
            price: "$0.01",
            maxTimeoutSeconds: 60,
          },
          description: "Nebius inference call",
          mimeType: "application/json",
        },
      },
      server,
    ),
  );
  app.get("/infer", async (req, res) => {
    const prompt = req.query.prompt;
    if (typeof prompt !== "string" || prompt.length === 0) {
      res.status(400).json({ error: "prompt query parameter is required" });
      return;
    }
    try {
      const response = await fetch("https://api.tokenfactory.nebius.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${nebiusApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 64,
        }),
      });
      if (!response.ok) {
        res.status(502).json({ error: `Nebius returned ${response.status}` });
        return;
      }
      const completion = await response.json();
      res.json({
        model: completion.model ?? "openai/gpt-oss-120b",
        output: completion.choices?.[0]?.message?.content ?? "",
        usage: completion.usage ?? null,
      });
    } catch {
      res.status(502).json({ error: "Nebius inference request failed" });
    }
  });
  const http = createServer(app);
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  return { http, url: `http://127.0.0.1:${http.address().port}/infer` };
}

async function startLocalFacilitator() {
  const local = new x402Facilitator().register(
    "stellar:testnet",
    new ExactStellarFacilitator(
      [createEd25519Signer(keys.facilitator)],
      {
        rpcConfig: { url: TESTNET_RPC },
        areFeesSponsored: true,
        maxTransactionFeeStroops: 100_000_000,
      },
    ),
  );
  const app = express();
  app.use(express.json());
  app.get("/supported", (_req, res) => res.json(local.getSupported()));
  app.post("/verify", async (req, res) => {
    try {
      res.json(await local.verify(req.body.paymentPayload, req.body.paymentRequirements));
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });
  app.post("/settle", async (req, res) => {
    try {
      res.json(await local.settle(req.body.paymentPayload, req.body.paymentRequirements));
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });
  const http = createServer(app);
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const url = `http://127.0.0.1:${http.address().port}`;
  return { http, url };
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function succeeded(result) {
  return result?.status === 200 && result.paymentResponse?.success === true;
}

async function main() {
  const supported = await new HTTPFacilitatorClient({ url: FACILITATOR_URL }).getSupported();
  const exact = supported.kinds.find((kind) => kind.scheme === "exact" && kind.network === "stellar:testnet");
  if (!exact || exact.extra?.areFeesSponsored !== true) {
    throw new Error(`Facilitator does not support sponsored exact Stellar testnet payments: ${JSON.stringify(exact)}`);
  }
  console.log(`facilitator supported: ${JSON.stringify(exact)}`);

  const buyer = Keypair.random();
  await friendbot(buyer);
  await createBuyerTrustline();
  console.log(`buyer funded ${buyer.publicKey()}`);

  await setBuyerPolicy(buyer, AMOUNT);
  const initialTeamBalance = await read(USDC, "balance", new Address(teamAccount).toScVal());
  const initialPayeeBalance = await read(USDC, "balance", new Address(payee.publicKey()).toScVal());
  let facilitatorUrl = FACILITATOR_URL;
  let localFacilitator;
  let seller = await startSeller(facilitatorUrl);
  try {
    let result;
    let x402OrgFailure;
    try {
      result = await payX402(seller.url, { secret: buyer.secret(), teamAccount });
    } catch (error) {
      x402OrgFailure = String(error);
    }
    if (!succeeded(result)) {
      x402OrgFailure ??= JSON.stringify(result?.paymentRequired ?? result?.body ?? result);
      console.log(`x402.org exact failure: ${x402OrgFailure}`);
      const teamAfterExternal = await read(USDC, "balance", new Address(teamAccount).toScVal());
      const payeeAfterExternal = await read(USDC, "balance", new Address(payee.publicKey()).toScVal());
      if (teamAfterExternal !== initialTeamBalance || payeeAfterExternal !== initialPayeeBalance) {
        throw new Error("x402.org outcome was not successful but balances changed; refusing a second payment");
      }
      await close(seller.http);
      localFacilitator = await startLocalFacilitator();
      facilitatorUrl = localFacilitator.url;
      seller = await startSeller(facilitatorUrl);
      result = await payX402(seller.url, { secret: buyer.secret(), teamAccount });
    }
    console.log(`successful call: status=${result.status} fee=${result.resourceFeeStroops} stroops body=${JSON.stringify(result.body)}`);
    console.log(`facilitator settlement: ${JSON.stringify(result.paymentResponse)}`);
    if (!succeeded(result) || !result.paymentResponse.transaction) {
      throw new Error(`x402 settlement failed through ${facilitatorUrl}: ${JSON.stringify(result)}`);
    }
    const afterPayment = await read(USDC, "balance", new Address(teamAccount).toScVal());

    await setBuyerPolicy(buyer, AMOUNT - 1n);
    const verdict = await read(
      teamAccount,
      "check",
      new Address(buyer.publicKey()).toScVal(),
      xdr.ScVal.scvSymbol("nebius_llm"),
      nativeToScVal(AMOUNT, { type: "i128" }),
    );
    let refused;
    try {
      refused = await payX402(seller.url, { secret: buyer.secret(), teamAccount });
    } catch (error) {
      refused = { status: 0, body: String(error) };
    }
    const afterRefusal = await read(USDC, "balance", new Address(teamAccount).toScVal());
    console.log(`over-cap call: status=${refused.status} response=${JSON.stringify(refused.paymentRequired ?? refused.body)}`);
    console.log(`over-cap policy check: ${JSON.stringify(verdict)}`);
    if (Number(verdict.rule) !== 8 || succeeded(refused) || afterRefusal !== afterPayment) {
      throw new Error(`over-cap request was not refused without moving funds (balances ${afterPayment} -> ${afterRefusal})`);
    }
    console.log(`over-cap refusal code=8 teamBalance=${afterRefusal}`);
  } finally {
    await close(seller.http);
    if (localFacilitator) await close(localFacilitator.http);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
