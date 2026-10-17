#!/usr/bin/env node
/**
 * Deploys v2 contracts, registers the Nebius listing, migrates the previous
 * team-account balance and writes deployment metadata and local testnet keys.
 *
 *   cargo build --target wasm32v1-none --release -p service-registry -p team-account
 *   pnpm --filter @ecorouter/app deploy:testnet
 *
 * OWNER_SECRET=S... reuses an existing funded owner instead of generating one.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  authorizeEntry,
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
const server = new rpc.Server(RPC_URL);
const log = (...a) => console.log(...a);
const record = { network: "testnet", networkPassphrase: PASSPHRASE, rpcUrl: RPC_URL, deployedAt: new Date().toISOString(), txs: {}, fees: {} };

/**
 * Makes sure `kp` exists on chain. Uses Friendbot when it is reachable;
 * otherwise `funder` (the owner) creates the account with a small balance.
 */
async function fund(kp, funder) {
  try {
    await server.getAccount(kp.publicKey());
    return;
  } catch {
    /* not on chain yet */
  }
  try {
    const res = await fetch(`${FRIENDBOT}?addr=${kp.publicKey()}`);
    if (res.ok) return;
    if (!funder) throw new Error(`friendbot ${res.status}`);
  } catch (e) {
    if (!funder) throw new Error(`${kp.publicKey()} is not funded and Friendbot is unreachable (${e?.message ?? e}). Send it testnet XLM and run again.`);
  }
  await classic(funder, Operation.createAccount({ destination: kp.publicKey(), startingBalance: "5" }), `create ${kp.publicKey().slice(0, 6)}`);
}

/** Builds, simulates, signs and submits one operation; returns the decoded return value. */
async function submit(source, op, label, signers = [source]) {
  const account = await server.getAccount(source.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE }).addOperation(op).setTimeout(120).build();
  let prepared;
  if (tx.operations[0]?.type === "invokeHostFunction") {
    const simulation = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(simulation)) {
      throw new Error(`${label}: simulation failed ${simulation.error}`);
    }
    const latestLedger = await server.getLatestLedger();
    const authEntries = await Promise.all((simulation.result?.auth ?? []).map(async (entry) => {
      const credentials = entry.credentials;
      if (credentials.type === "sorobanCredentialsSourceAccount") return entry;
      const addressCredentials = credentials.addressV2 ??
        credentials.address ??
        credentials.addressWithDelegates?.addressCredentials;
      if (!addressCredentials) throw new Error(`${label}: unsupported authorization credentials`);
      const address = Address.fromScAddress(addressCredentials.address).toString();
      const signer = signers.find((candidate) => candidate.publicKey() === address);
      if (!signer) throw new Error(`${label}: missing authorization signer ${address}`);
      return authorizeEntry(entry, signer, latestLedger.sequence + 30, PASSPHRASE, address);
    }));
    const invoke = tx.operations[0];
    const authorized = rpc.assembleTransaction(tx, simulation)
      .clearOperations()
      .addOperation(Operation.invokeHostFunction({
        source: invoke.source,
        func: invoke.func,
        auth: authEntries,
      }))
      .build();
    const authorizedSimulation = await server.simulateTransaction(authorized);
    if (!rpc.Api.isSimulationSuccess(authorizedSimulation)) {
      throw new Error(`${label}: authorized simulation failed ${authorizedSimulation.error}`);
    }
    prepared = rpc.assembleTransaction(authorized, authorizedSimulation).build();
  } else {
    prepared = await server.prepareTransaction(tx);
  }
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`${label}: rejected ${sent.errorResult?.toXDR("base64")}`);
  const done = await server.pollTransaction(sent.hash, { attempts: 40 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`${label}: ${done.status} (${sent.hash})`);
  record.txs[label] = sent.hash;
  record.fees[label] = String(done.feeCharged ?? prepared.fee ?? BASE_FEE);
  log(`  ✓ ${label}  ${sent.hash}  fee=${record.fees[label]} stroops`);
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
  record.txs[label] = sent.hash;
  record.fees[label] = String(done.feeCharged ?? BASE_FEE);
  log(`  ✓ ${label}  ${sent.hash}  fee=${record.fees[label]} stroops`);
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

function optimizeWasm(path) {
  const version = spawnSync("wasm-opt", ["--version"], { encoding: "utf8" });
  if (version.error?.code === "ENOENT") {
    log("  · wasm-opt unavailable; using Cargo release WASM");
    return path;
  }
  const output = path.replace(/\.wasm$/, ".optimized.wasm");
  const result = spawnSync("wasm-opt", ["-Oz", path, "-o", output], { encoding: "utf8" });
  if (result.error || result.status !== 0 || !existsSync(output)) {
    throw new Error(`wasm-opt -Oz failed: ${result.stderr ?? result.error?.message ?? result.status}`);
  }
  if (statSync(output).size >= statSync(path).size) {
    log(`  · wasm-opt -Oz did not reduce ${path}`);
    return path;
  }
  log(`  · wasm-opt -Oz reduced ${path}: ${statSync(path).size} -> ${statSync(output).size} bytes`);
  return output;
}

function wasmMetadata(file, contractId) {
  const wasm = readFileSync(optimizeWasm(resolve(ROOT, "target/wasm32v1-none/release", file)));
  return { contractId, wasmHash: createHash("sha256").update(wasm).digest("hex"), wasmBytes: wasm.length };
}

async function deployWasm(owner, file, label, constructorArgs) {
  const path = resolve(ROOT, "target/wasm32v1-none/release", file);
  if (!existsSync(path)) throw new Error(`${path} not found. Build it first:\n  cargo build --target wasm32v1-none --release -p service-registry -p team-account`);
  const wasm = readFileSync(optimizeWasm(path));
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
  const teamOnly = process.argv.includes("--team-account-only");
  const resumeRegistryId = process.argv.find((arg) => arg.startsWith("--registry-id="))?.split("=")[1];
  const resumeTeamAccountId = process.argv.find((arg) => arg.startsWith("--team-account-id="))?.split("=")[1];
  if (Boolean(resumeRegistryId) !== Boolean(resumeTeamAccountId) || (teamOnly && resumeRegistryId)) {
    throw new Error("Resuming a partial deploy requires both --registry-id and --team-account-id");
  }
  const gatewayUrl = process.env.PUBLIC_URL;
  if (!teamOnly && !gatewayUrl) throw new Error("PUBLIC_URL is required to register the gateway endpoint");
  const gatewayBase = gatewayUrl?.replace(/\/$/, "");
  const keysPath = resolve(ROOT, ".deploy/testnet-keys.json");
  mkdirSync(dirname(keysPath), { recursive: true });
  const keys = existsSync(keysPath) ? JSON.parse(readFileSync(keysPath, "utf8")) : {};
  const oldDeployment = JSON.parse(readFileSync(resolve(ROOT, "deployments/testnet.json"), "utf8"));
  const { previous: earlierDeployments, ...currentDeployment } = oldDeployment;
  record.previous = [
    currentDeployment,
    ...(Array.isArray(earlierDeployments)
      ? earlierDeployments
      : earlierDeployments
        ? [earlierDeployments]
        : []),
  ];
  const owner = process.env.OWNER_SECRET ? Keypair.fromSecret(process.env.OWNER_SECRET) : keys.owner ? Keypair.fromSecret(keys.owner) : Keypair.random();
  keys.owner = owner.secret();
  writeFileSync(keysPath, JSON.stringify(keys, null, 2), { mode: 0o600 });
  chmodSync(keysPath, 0o600);

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

  let registryId;
  if (teamOnly) {
    registryId = oldDeployment.registry.contractId;
    record.registry = oldDeployment.registry;
    record.services = oldDeployment.services;
    log(`service registry (reuse)  ${registryId}`);
  } else if (resumeRegistryId) {
    registryId = resumeRegistryId;
    record.registry = wasmMetadata("service_registry.wasm", registryId);
    log(`service registry (resume)  ${registryId}`);
  } else {
    log("service registry");
    registryId = await deployWasm(owner, "service_registry.wasm", "registry", [new Address(owner.publicKey()).toScVal()]);
    log(`  ${registryId}`);
  }

  log("team account");
  const accountId = resumeTeamAccountId
    ? resumeTeamAccountId
    : await deployWasm(owner, "team_account.wasm", "teamAccount", [
        new Address(owner.publicKey()).toScVal(),
        new Address(usdcId).toScVal(),
        new Address(registryId).toScVal(),
      ]);
  if (resumeTeamAccountId) record.teamAccount = wasmMetadata("team_account.wasm", accountId);
  log(`  ${accountId}`);

  if (!teamOnly) {
    log("Nebius listing");
    const seller = keys.seller ? Keypair.fromSecret(keys.seller) : Keypair.random();
    const payee = keys.payee ? Keypair.fromSecret(keys.payee) : Keypair.random();
    keys.seller = seller.secret();
    keys.payee = payee.secret();
    const facilitator = keys.facilitator ? Keypair.fromSecret(keys.facilitator) : Keypair.random();
    keys.facilitator = facilitator.secret();
    writeFileSync(keysPath, JSON.stringify(keys, null, 2), { mode: 0o600 });
    chmodSync(keysPath, 0o600);
    await fund(seller, owner);
    await fund(payee, owner);
    await fund(facilitator, owner);
    await classic(seller, Operation.changeTrust({ asset: USDC }), "trustline seller");
    await classic(payee, Operation.changeTrust({ asset: USDC }), "trustline payee");
    const existingNebius = await read(registryId, "get", xdr.ScVal.scvSymbol("nebius_llm"));
    if (!existingNebius.error) {
      log("  · nebius_llm already registered");
    } else {
      if (!/Error\(Contract, #3\)/.test(existingNebius.error)) throw new Error(existingNebius.error);
      await submit(
        seller,
        new Contract(registryId).call(
        "register",
        new Address(seller.publicKey()).toScVal(),
        xdr.ScVal.scvSymbol("nebius_llm"),
        nativeToScVal("Nebius inference", { type: "string" }),
        nativeToScVal("LLM inference with gpt-oss-120b: send a prompt, get a completion", { type: "string" }),
        xdr.ScVal.scvSymbol("api"),
        new Address(payee.publicKey()).toScVal(),
        nativeToScVal(`${gatewayBase}/a/nebius_llm`, { type: "string" }),
        nativeToScVal(100_000n, { type: "i128" }),
        ),
        "register nebius_llm",
        [seller, payee],
      );
    }
    const echoSeller = keys.echoSeller ? Keypair.fromSecret(keys.echoSeller) : Keypair.random();
    const echoPayee = keys.echoPayee ? Keypair.fromSecret(keys.echoPayee) : Keypair.random();
    keys.echoSeller = echoSeller.secret();
    keys.echoPayee = echoPayee.secret();
    writeFileSync(keysPath, JSON.stringify(keys, null, 2), { mode: 0o600 });
    chmodSync(keysPath, 0o600);
    await fund(echoSeller, owner);
    await fund(echoPayee, owner);
    await classic(echoSeller, Operation.changeTrust({ asset: USDC }), "trustline echo seller");
    await classic(echoPayee, Operation.changeTrust({ asset: USDC }), "trustline echo payee");
    const existingEcho = await read(registryId, "get", xdr.ScVal.scvSymbol("echo_mcp"));
    if (!existingEcho.error) {
      log("  · echo_mcp already registered");
    } else {
      if (!/Error\(Contract, #3\)/.test(existingEcho.error)) throw new Error(existingEcho.error);
      await submit(
        echoSeller,
        new Contract(registryId).call(
        "register",
        new Address(echoSeller.publicKey()).toScVal(),
        xdr.ScVal.scvSymbol("echo_mcp"),
        nativeToScVal("Echo MCP", { type: "string" }),
        nativeToScVal("Echo test tool: returns your text, uppercased", { type: "string" }),
        xdr.ScVal.scvSymbol("mcp"),
        new Address(echoPayee.publicKey()).toScVal(),
        nativeToScVal(`${gatewayBase}/a/echo_mcp`, { type: "string" }),
        nativeToScVal(50_000n, { type: "i128" }),
        ),
        "register echo_mcp",
        [echoSeller, echoPayee],
      );
    }
    record.services = {
      nebius_llm: {
        name: "Nebius inference",
        task: "LLM inference with gpt-oss-120b: send a prompt, get a completion",
        kind: "api",
        seller: seller.publicKey(),
        payee: payee.publicKey(),
        url: `${gatewayBase}/a/nebius_llm`,
        price: "100000",
      },
      echo_mcp: {
        name: "Echo MCP",
        task: "Echo test tool: returns your text, uppercased",
        kind: "mcp",
        seller: echoSeller.publicKey(),
        payee: echoPayee.publicKey(),
        url: `${gatewayBase}/a/echo_mcp`,
        price: "50000",
      },
    };
  }
  await classic(owner, Operation.changeTrust({ asset: USDC }), "trustline owner");

  const oldBalance = await read(oldDeployment.teamAccount.contractId, "balance");
  if (oldBalance.error) throw new Error(`Could not read previous team-account balance: ${oldBalance.error}`);
  const migrationAmount = BigInt(oldBalance.value);
  if (migrationAmount <= 0n || migrationAmount > 700_000_000n) {
    throw new Error(`Previous team-account balance is outside the expected migration range: ${migrationAmount}`);
  }
  if (migrationAmount < 700_000_000n) {
    log(`  · migrating available balance ${migrationAmount} stroops; prior payments reduced the original 70 USDC`);
  }
  await submit(
    owner,
    new Contract(oldDeployment.teamAccount.contractId).call(
      "withdraw",
      new Address(owner.publicKey()).toScVal(),
      nativeToScVal(migrationAmount, { type: "i128" }),
    ),
    "withdraw 70 USDC from previous team account",
  );
  await submit(
    owner,
    new Contract(usdcId).call(
      "transfer",
      new Address(owner.publicKey()).toScVal(),
      new Address(accountId).toScVal(),
      nativeToScVal(migrationAmount, { type: "i128" }),
    ),
    "deposit 70 USDC into new team account",
  );

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
  writeFileSync(keysPath, JSON.stringify(keys, null, 2), { mode: 0o600 });
  chmodSync(keysPath, 0o600);
  log("\nextending contract code and instance TTL by 7 days");
  const ttl = spawnSync(process.execPath, [resolve(ROOT, "packages/app/scripts/extend-ttl.mjs"), "--days", "7"], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (ttl.error || ttl.status !== 0) throw new Error(`extend-ttl failed: ${ttl.error?.message ?? ttl.status}`);
  log("\nwrote deployments/testnet.json and local .deploy/testnet-keys.json");
  log(`explorer  https://stellar.expert/explorer/testnet/contract/${accountId}`);
  log("next      send testnet USDC to the team account, then add spenders in the app");
}

main().catch((e) => {
  console.error(`\ndeploy failed: ${e?.message ?? e}`);
  process.exit(1);
});
