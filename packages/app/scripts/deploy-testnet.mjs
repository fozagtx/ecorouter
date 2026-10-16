#!/usr/bin/env node
/**
 * Deploys the service registry and a team account to Stellar testnet with
 * the JS SDK alone (no Stellar CLI), registers demo services, reads the
 * deployment back, and writes:
 *   - packages/app/.env.local        contract ids for the app's Testnet mode
 *   - deployments/testnet.json       ids, wasm hashes and transaction hashes
 *   - .deploy/testnet-keys.json      generated secrets (gitignored)
 *
 *   cargo build --target wasm32v1-none --release -p service-registry -p team-account
 *   pnpm --filter @ecorouter/app deploy:testnet
 *
 * OWNER_SECRET=S... reuses an existing funded owner instead of generating one.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const FRIENDBOT = process.env.FRIENDBOT_URL || "https://friendbot.stellar.org";
// Circle's testnet USDC issuer.
const USDC = new Asset("USDC", process.env.USDC_ISSUER || "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const SERVICES = [
  ["inference", "Inference credits"],
  ["search", "Web search API"],
  ["data", "Market data feed"],
  ["gpu", "GPU hours"],
  ["storage", "Object storage"],
];

const server = new rpc.Server(RPC_URL);
const log = (...a) => console.log(...a);
const record = { network: "testnet", rpcUrl: RPC_URL, deployedAt: new Date().toISOString(), txs: {} };

async function fund(kp) {
  try {
    await server.getAccount(kp.publicKey());
    return;
  } catch {
    /* not on chain yet */
  }
  const res = await fetch(`${FRIENDBOT}?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}: ${await res.text()}`);
}

/** Builds, simulates, signs and submits one operation; returns the decoded return value. */
async function submit(source, op, label, signers = [source]) {
  const account = await server.getAccount(source.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE }).addOperation(op).setTimeout(120).build();
  const prepared = await server.prepareTransaction(tx);
  for (const s of signers) prepared.sign(s);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`${label}: rejected ${sent.errorResult?.toXDR("base64")}`);
  const done = await server.pollTransaction(sent.hash, { attempts: 40 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`${label}: ${done.status} (${sent.hash})`);
  record.txs[label] = sent.hash;
  log(`  ✓ ${label}  ${sent.hash}`);
  return done.returnValue ? scValToNative(done.returnValue) : undefined;
}

/** Classic (non-Soroban) transaction, e.g. a trustline. */
async function classic(kp, op, label) {
  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE }).addOperation(op).setTimeout(120).build();
  tx.sign(kp);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") throw new Error(`${label}: rejected`);
  const done = await server.pollTransaction(sent.hash, { attempts: 40 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`${label}: ${done.status}`);
  log(`  ✓ ${label}`);
}

async function read(contractId, method, ...args) {
  const source = Keypair.random().publicKey();
  const tx = new TransactionBuilder(new Account(source, "0"), { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return { error: sim.error };
  return { value: scValToNative(sim.result.retval) };
}

async function deployWasm(owner, file, label, constructorArgs) {
  const path = resolve(ROOT, "target/wasm32v1-none/release", file);
  if (!existsSync(path)) throw new Error(`${path} not found. Build it first:\n  cargo build --target wasm32v1-none --release -p service-registry -p team-account`);
  const wasm = readFileSync(path);
  const hash = createHash("sha256").update(wasm).digest();
  try {
    await submit(owner, Operation.uploadContractWasm({ wasm }), `upload ${label}`);
  } catch (e) {
    // Identical code already on chain is fine; anything else is not.
    if (!/ExistingValue|already exists/i.test(String(e?.message ?? e))) throw e;
    log(`  · ${label} wasm already uploaded`);
  }
  const id = await submit(
    owner,
    Operation.createCustomContract({ address: new Address(owner.publicKey()), wasmHash: hash, salt: randomBytes(32), constructorArgs }),
    `deploy ${label}`,
  );
  record[label] = { contractId: id, wasmHash: hash.toString("hex"), wasmBytes: wasm.length };
  return id;
}

async function main() {
  const keysPath = resolve(ROOT, ".deploy/testnet-keys.json");
  mkdirSync(dirname(keysPath), { recursive: true });
  const keys = existsSync(keysPath) ? JSON.parse(readFileSync(keysPath, "utf8")) : {};
  const owner = process.env.OWNER_SECRET ? Keypair.fromSecret(process.env.OWNER_SECRET) : keys.owner ? Keypair.fromSecret(keys.owner) : Keypair.random();
  keys.owner = owner.secret();
  writeFileSync(keysPath, JSON.stringify(keys, null, 2));

  log(`network   ${RPC_URL}`);
  log(`owner     ${owner.publicKey()}`);
  await fund(owner);
  record.owner = owner.publicKey();

  log("usdc");
  const usdcId = USDC.contractId(PASSPHRASE);
  try {
    await submit(owner, Operation.createStellarAssetContract({ asset: USDC }), "wrap usdc");
  } catch (e) {
    if (!/ExistingValue|already exists|contract already/i.test(String(e?.message ?? e))) throw e;
    log("  · USDC asset contract already exists");
  }
  record.usdc = usdcId;
  log(`  ${usdcId}`);

  log("service registry");
  const registryId = await deployWasm(owner, "service_registry.wasm", "registry", [new Address(owner.publicKey()).toScVal()]);
  log(`  ${registryId}`);

  log("team account");
  const accountId = await deployWasm(owner, "team_account.wasm", "teamAccount", [
    new Address(owner.publicKey()).toScVal(),
    new Address(usdcId).toScVal(),
    new Address(registryId).toScVal(),
  ]);
  log(`  ${accountId}`);

  log("services");
  keys.payees ??= {};
  record.services = {};
  for (const [id, name] of SERVICES) {
    const payee = keys.payees[id] ? Keypair.fromSecret(keys.payees[id]) : Keypair.random();
    keys.payees[id] = payee.secret();
    writeFileSync(keysPath, JSON.stringify(keys, null, 2));
    await fund(payee);
    // A classic USDC balance needs a trustline before it can receive.
    await classic(payee, Operation.changeTrust({ asset: USDC }), `trustline ${id}`);
    await submit(
      owner,
      new Contract(registryId).call("register", xdr.ScVal.scvSymbol(id), nativeToScVal(name, { type: "string" }), new Address(payee.publicKey()).toScVal()),
      `register ${id}`,
    );
    record.services[id] = { name, payee: payee.publicKey() };
  }
  await classic(owner, Operation.changeTrust({ asset: USDC }), "trustline owner");

  log("read back");
  const checks = {
    "team version": await read(accountId, "version"),
    "team owner": await read(accountId, "owner"),
    "team registry": await read(accountId, "registry"),
    "registry list": await read(registryId, "list"),
    "unknown service reverts": await read(registryId, "resolve", xdr.ScVal.scvSymbol("invented")),
  };
  for (const [k, v] of Object.entries(checks)) log(`  ${k}: ${JSON.stringify(v.value ?? v.error, (_k, x) => (typeof x === "bigint" ? x.toString() : x)).slice(0, 160)}`);
  if (checks["team owner"].value !== owner.publicKey()) throw new Error("owner read-back mismatch");
  if (checks["team registry"].value !== registryId) throw new Error("registry read-back mismatch");
  if (!/Error\(Contract, #3\)/.test(checks["unknown service reverts"].error ?? "")) throw new Error("unknown service did not revert with UnknownService (#3)");
  record.readBack = "ok";

  mkdirSync(resolve(ROOT, "deployments"), { recursive: true });
  writeFileSync(resolve(ROOT, "deployments/testnet.json"), JSON.stringify(record, null, 2) + "\n");
  writeFileSync(
    resolve(ROOT, "packages/app/.env.local"),
    `VITE_STELLAR_NETWORK=testnet\nVITE_RPC_URL=${RPC_URL}\nVITE_TEAM_ACCOUNT_ID=${accountId}\nVITE_REGISTRY_ID=${registryId}\nVITE_USDC_ID=${usdcId}\n`,
  );
  log("\nwrote deployments/testnet.json and packages/app/.env.local");
  log(`explorer  https://stellar.expert/explorer/testnet/contract/${accountId}`);
  log("next      send testnet USDC to the team account, then add spenders in the app");
}

main().catch((e) => {
  console.error(`\ndeploy failed: ${e?.message ?? e}`);
  process.exit(1);
});
