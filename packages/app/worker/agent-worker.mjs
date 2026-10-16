#!/usr/bin/env node
/**
 * Agent worker: lets an AI agent pay from the team account on a schedule,
 * signing with its own key. The key never touches the web app, and the
 * contract checks every payment against the agent's policy. A refused payment
 * stops there; agents cannot file approval requests.
 *
 *   AGENT_SECRET=S... TEAM_ACCOUNT_ID=C... \
 *     node packages/app/worker/agent-worker.mjs --service search --amount 4 --every day [--memo "..."] [--once]
 *
 * Each payment carries a fresh idempotency key that is written to disk before
 * submission, so a crash mid-payment is resolved by asking the contract whether
 * the key was used, never by paying again.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Address, BASE_FEE, Contract, Keypair, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]]] : acc), []),
);
const SECRET = process.env.AGENT_SECRET;
const ACCOUNT = process.env.TEAM_ACCOUNT_ID;
const RPC = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const PASSPHRASE = process.env.NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";
const EVERY = { hour: 3600, day: 86400, week: 604800 }[args.every || "day"];
if (!SECRET || !ACCOUNT || !args.service || !args.amount || !EVERY) {
  console.error("usage: AGENT_SECRET=S… TEAM_ACCOUNT_ID=C… agent-worker.mjs --service <id> --amount <usdc> --every hour|day|week [--memo text] [--once]");
  process.exit(2);
}

const agent = Keypair.fromSecret(SECRET);
const server = new rpc.Server(RPC);
const team = new Contract(ACCOUNT);
const STATE = process.env.AGENT_STATE || `.agent-${agent.publicKey().slice(0, 8)}.json`;
const toAtomic = (s) => {
  const [w, f = ""] = String(s).split(".");
  return BigInt(w) * 10_000_000n + BigInt(f.padEnd(7, "0").slice(0, 7) || "0");
};

function load() {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { lastRun: 0, inflight: null };
}
function save(s) {
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

async function call(method, ...a) {
  const source = await server.getAccount(agent.publicKey());
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: PASSPHRASE }).addOperation(team.call(method, ...a)).setTimeout(120).build();
  return { tx, source };
}

async function keyUsed(keyHex) {
  const { tx } = await call("is_key_used", new Address(agent.publicKey()).toScVal(), xdr.ScVal.scvBytes(Buffer.from(keyHex, "hex")));
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result.retval) === true;
}

async function payOnce(state) {
  if (state.inflight) {
    // Wait out the transaction's 120 s validity window so it cannot still land.
    if (Math.floor(Date.now() / 1000) < state.inflight.at + 150) return;
    // Recover: the chain says whether the last attempt paid.
    const used = await keyUsed(state.inflight.key);
    console.log(`recovered in-flight payment ${state.inflight.key.slice(0, 8)}: ${used ? "it paid" : "it did not pay"}`);
    if (used) state.lastRun = state.inflight.at;
    state.inflight = null;
    save(state);
    if (used) return;
  }
  const key = randomBytes(32).toString("hex");
  state.inflight = { key, at: Math.floor(Date.now() / 1000) };
  save(state);
  const amount = toAtomic(args.amount);
  const { tx } = await call(
    "pay",
    new Address(agent.publicKey()).toScVal(),
    xdr.ScVal.scvSymbol(args.service),
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(args.memo || `scheduled ${args.service}`, { type: "string" }),
    xdr.ScVal.scvBytes(Buffer.from(key, "hex")),
  );
  let prepared;
  try {
    prepared = await server.prepareTransaction(tx);
  } catch (e) {
    const code = /Error\(Contract, #(\d+)\)/.exec(String(e?.message ?? e))?.[1];
    console.log(`refused by the contract${code ? ` (error #${code})` : ""}; no money moved, nothing filed`);
    state.inflight = null;
    state.lastRun = Math.floor(Date.now() / 1000);
    save(state);
    return;
  }
  prepared.sign(agent);
  const sent = await server.sendTransaction(prepared);
  state.inflight.hash = sent.hash;
  save(state);
  const done = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (done.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    console.log(`paid ${args.amount} USDC to ${args.service}: ${sent.hash}`);
    state.inflight = null;
    state.lastRun = Math.floor(Date.now() / 1000);
    save(state);
  } else {
    console.log(`transaction ${sent.hash} is ${done.status}; will check the key before trying again`);
  }
}

const state = load();
for (;;) {
  const now = Math.floor(Date.now() / 1000);
  if (state.inflight || now - state.lastRun >= EVERY) {
    try {
      await payOnce(state);
    } catch (e) {
      console.error(`attempt failed: ${e?.message ?? e}`);
    }
  }
  if (args.once === "true") break;
  await new Promise((r) => setTimeout(r, 60_000));
}
