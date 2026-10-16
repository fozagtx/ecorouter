import { Address, BASE_FEE, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { Rule, TESTNET, TeamAgent, scheduleKey } from "../dist/index.js";

if (process.env.ECOROUTER_LIVE !== "1") {
  console.log("Set ECOROUTER_LIVE=1 to run the testnet integration script.");
  process.exit(0);
}

const ownerSecret = process.env.OWNER_SECRET;
if (!ownerSecret) throw new Error("OWNER_SECRET is required when ECOROUTER_LIVE=1.");

const owner = Keypair.fromSecret(ownerSecret);
const agentKey = Keypair.random();
const server = new rpc.Server(TESTNET.rpcUrl);
const explorer = (hash) => `${TESTNET.explorer}/tx/${hash}`;
const asI128 = (value) => nativeToScVal(value, { type: "i128" });
const asU64 = (value) => nativeToScVal(BigInt(value), { type: "u64" });
const asU32 = (value) => nativeToScVal(value, { type: "u32" });
const asString = (value) => nativeToScVal(value, { type: "string" });
const symbol = (value) => xdr.ScVal.scvSymbol(value);

async function submit(contract, method, source, ...args) {
  const account = await server.getAccount(source.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(contract.call(method, ...args))
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`Transaction rejected: ${sent.errorResult?.toXDR("base64") ?? sent.status}`);
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      console.log(JSON.stringify({ event: "transaction", txHash: sent.hash, explorerUrl: explorer(sent.hash) }));
      return { hash: sent.hash, result };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Transaction ${sent.hash} was not confirmed within about 60 seconds.`);
}

const funded = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(agentKey.publicKey())}`);
if (!funded.ok) throw new Error(`Friendbot returned ${funded.status}.`);
const fundedBody = await funded.json().catch(() => ({}));
if (fundedBody.hash) {
  console.log(JSON.stringify({ event: "friendbot", txHash: fundedBody.hash, explorerUrl: explorer(fundedBody.hash) }));
}

const period = 30 * 24 * 60 * 60;
const expiresAt = Math.floor(Date.now() / 1_000) + 90 * 24 * 60 * 60;
const policy = xdr.ScVal.scvMap([
  ["allowance", asI128(20_000_000n)],
  ["expires_at", asU64(expiresAt)],
  ["kind", asU32(1)],
  ["label", asString("SDK live test agent")],
  ["max_payment", asI128(5_000_000n)],
  ["max_payments", asU32(5)],
  ["period", asU64(period)],
  ["services", xdr.ScVal.scvVec([symbol("search")])],
].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => new xdr.ScMapEntry({ key: symbol(key), val: value })));

await submit(
  new Contract(TESTNET.teamAccount),
  "set_policy",
  owner,
  new Address(agentKey.publicKey()).toScVal(),
  policy,
);

const agent = new TeamAgent({ secret: agentKey.secret() });
const key = scheduleKey(TESTNET.teamAccount, agent.address, "search", Math.floor(Date.now() / 1_000));
const paid = await agent.pay({ service: "search", amount: "0.25", key, memo: "SDK live test" });
if (paid.status !== "paid") throw new Error(`Expected first payment to be paid, got ${paid.status}.`);
console.log(JSON.stringify({ event: "paid", key: paid.key, txHash: paid.txHash, explorerUrl: paid.explorerUrl, receipt: paid.receipt }));

const duplicate = await agent.pay({ service: "search", amount: "0.25", key, memo: "SDK live test" });
if (duplicate.status !== "refused" || duplicate.rule !== Rule.DuplicatePayment) {
  throw new Error(`Expected duplicate key refusal (${Rule.DuplicatePayment}).`);
}
console.log(JSON.stringify({ event: "duplicate_refused", rule: duplicate.rule, reason: duplicate.reason }));

const overCap = await agent.pay({ service: "search", amount: "0.75", key: scheduleKey(TESTNET.teamAccount, agent.address, "search", 2) });
if (overCap.status !== "refused" || overCap.rule !== Rule.OverPaymentCap) {
  throw new Error(`Expected cap refusal (${Rule.OverPaymentCap}).`);
}
console.log(JSON.stringify({ event: "cap_refused", rule: overCap.rule, reason: overCap.reason }));

const disallowed = await agent.pay({ service: "gpu", amount: "0.25", key: scheduleKey(TESTNET.teamAccount, agent.address, "gpu", 3) });
if (disallowed.status !== "refused" || disallowed.rule !== Rule.ServiceNotAllowed) {
  throw new Error(`Expected service refusal (${Rule.ServiceNotAllowed}).`);
}
console.log(JSON.stringify({ event: "service_refused", rule: disallowed.rule, reason: disallowed.reason }));
