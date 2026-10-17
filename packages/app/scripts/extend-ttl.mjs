#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  rpc,
} from "@stellar/stellar-sdk";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const DAY_IN_LEDGERS = 17_280;
const MAX_FEE_STROOPS = 1_000_000_000n;
const server = new rpc.Server(RPC_URL);

function daysArg() {
  const index = process.argv.indexOf("--days");
  const days = Number(index >= 0 ? process.argv[index + 1] : 7);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("--days must be an integer from 1 to 365");
  }
  return days;
}

async function footprintFor(contractId, source) {
  const tx = new TransactionBuilder(
    new Account(source.publicKey(), (await server.getAccount(source.publicKey())).sequenceNumber()),
    { fee: BASE_FEE, networkPassphrase: PASSPHRASE },
  )
    .addOperation(new Contract(contractId).call("owner"))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`owner simulation failed: ${sim.error}`);
  const footprint = sim.transactionData.build().resources.footprint;
  return [...footprint.readOnly, ...footprint.readWrite];
}

async function simulateExtension(source, keys, extendTo) {
  const account = await server.getAccount(source.publicKey());
  const data = new SorobanDataBuilder()
    .setFootprint(keys, [])
    .setResources(0, 0, 0)
    .setResourceFee("0")
    .build();
  const raw = new TransactionBuilder(
    new Account(source.publicKey(), account.sequenceNumber()),
    { fee: BASE_FEE, networkPassphrase: PASSPHRASE },
  )
    .addOperation(Operation.extendFootprintTtl({ extendTo }))
    .setSorobanData(data)
    .setTimeout(120)
    .build();
  const sim = await server.simulateTransaction(raw);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`TTL simulation failed: ${sim.error}`);
  return { raw, fee: BigInt(sim.minResourceFee), sim };
}

async function submit(source, planned, label) {
  if (planned.fee > MAX_FEE_STROOPS) throw new Error(`${label} still exceeds 100 XLM: ${planned.fee} stroops`);
  const prepared = rpc.assembleTransaction(planned.raw, planned.sim).build();
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`${label}: ${sent.errorResult?.toXDR("base64")}`);
  const done = await server.pollTransaction(sent.hash, { attempts: 40 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`${label}: ${done.status}`);
  console.log(`${label}: fee=${done.feeCharged ?? prepared.fee} stroops tx=${sent.hash}`);
}

async function main() {
  if (!process.env.OWNER_SECRET) throw new Error("OWNER_SECRET is required");
  const deployment = JSON.parse(readFileSync(resolve(ROOT, "deployments/testnet.json"), "utf8"));
  const owner = Keypair.fromSecret(process.env.OWNER_SECRET);
  const extendTo = daysArg() * DAY_IN_LEDGERS;
  for (const [name, item] of [["team account", deployment.teamAccount], ["registry", deployment.registry]]) {
    const keys = await footprintFor(item.contractId, owner);
    const grouped = await simulateExtension(owner, keys, extendTo);
    console.log(`${name} code+instance: simulated_fee=${grouped.fee} stroops`);
    if (grouped.fee <= MAX_FEE_STROOPS) {
      await submit(owner, grouped, `${name} code+instance`);
      continue;
    }
    if (keys.length < 2) throw new Error(`${name}: cannot split footprint below 100 XLM`);
    for (const [index, key] of keys.entries()) {
      const single = await simulateExtension(owner, [key], extendTo);
      console.log(`${name} entry ${index + 1}: simulated_fee=${single.fee} stroops`);
      await submit(owner, single, `${name} entry ${index + 1}`);
    }
  }
}

main().catch((error) => {
  console.error(`extend-ttl failed: ${error?.message ?? error}`);
  process.exit(1);
});
