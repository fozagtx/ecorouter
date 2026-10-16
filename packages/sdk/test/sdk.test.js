import test from "node:test";
import assert from "node:assert/strict";
import deployment from "../../../deployments/testnet.json" with { type: "json" };
import { Account, Keypair, rpc } from "@stellar/stellar-sdk";
import {
  Rule,
  TeamAgent,
  TESTNET,
  contractErrorCode,
  formatUsdc,
  parseUsdc,
  ruleReason,
  scheduleKey,
} from "../dist/index.js";
import { decodePolicy, decodeReceipt, decodeUsage, decodeVerdict } from "../dist/codec.js";
import { CliUsageError, parsePayArguments, payExitCode, serializePayOutcome } from "../dist/cli.js";

test("scheduleKey is stable for the same team, agent, service, and slot", () => {
  const first = scheduleKey("team", "agent", "search", 42);
  assert.equal(first, scheduleKey("team", "agent", "search", 42));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, scheduleKey("team", "agent", "search", 43));
});

test("USDC amounts use seven decimal places", () => {
  assert.equal(parseUsdc("4.50"), 45_000_000n);
  assert.equal(parseUsdc("0.0000001"), 1n);
  assert.equal(formatUsdc(45_000_000n), "4.50");
  assert.throws(() => parseUsdc("0.00000001"));
});

test("TESTNET matches the committed deployment", () => {
  assert.equal(deployment.network, "testnet");
  assert.equal(TESTNET.rpcUrl, deployment.rpcUrl);
  assert.equal(TESTNET.networkPassphrase, deployment.networkPassphrase);
  assert.equal(TESTNET.teamAccount, deployment.teamAccount.contractId);
  assert.equal(TESTNET.registry, deployment.registry.contractId);
  assert.equal(TESTNET.usdc, deployment.usdc);
  assert.equal(TESTNET.explorer, "https://stellar.expert/explorer/testnet");
});

test("one-shot CLI parses required and optional payment arguments", () => {
  assert.deepEqual(parsePayArguments(["--service", "search", "--amount", "0.25", "--memo", "daily query", "--key", "a".repeat(64)]), {
    service: "search",
    amount: "0.25",
    memo: "daily query",
    key: "a".repeat(64),
  });
  assert.deepEqual(parsePayArguments(["--service", "search", "--amount", "0.25"]), {
    service: "search",
    amount: "0.25",
  });
  assert.throws(() => parsePayArguments(["--service", "search"]), CliUsageError);
  assert.throws(() => parsePayArguments(["--service", "search", "--amount", "0.25", "--unknown", "x"]), CliUsageError);
  assert.throws(() => parsePayArguments(["--service", "search", "--amount", "0.25", "--key", "bad"]), CliUsageError);
});

test("one-shot CLI serializes bigint fields as strings and maps outcome exit codes", () => {
  const outcome = {
    status: "refused",
    key: "a".repeat(64),
    rule: Rule.OverPaymentCap,
    reason: "Over the per-payment cap",
    overBy: 2_500_000n,
  };
  assert.equal(serializePayOutcome(outcome), JSON.stringify({ ...outcome, overBy: "2500000" }));
  assert.equal(payExitCode({ ...outcome, status: "paid", txHash: "hash", explorerUrl: "url", receipt: {
    spender: "GSPENDER", service: "search", payee: "GPAYEE", amount: 1n, memo: "",
    periodSpent: 1n, allowanceLeft: 2n, at: 3,
  } }), 0);
  assert.equal(payExitCode(outcome), 3);
  assert.equal(payExitCode({ status: "pending", key: outcome.key, txHash: "hash" }), 4);
});

test("contract errors map to contract codes and rule titles", () => {
  assert.equal(contractErrorCode("HostError: Error(Contract, #8)"), 8);
  assert.equal(contractErrorCode("not a contract error"), null);
  assert.equal(ruleReason(Rule.OverPaymentCap), "Over the per-payment cap");
  assert.equal(ruleReason(999), "Contract error #999");
});

test("native policy, usage, verdict, and receipt values decode to camelCase", () => {
  const policy = decodePolicy({
    kind: 1,
    label: "agent",
    allowance: 20_000_000n,
    period: 2_592_000,
    max_payment: 5_000_000n,
    max_payments: 5,
    expires_at: 1_900_000_000,
    services: ["search"],
    paused: false,
    anchor: 1_700_000_000,
  });
  assert.deepEqual(policy, {
    kind: "agent",
    label: "agent",
    allowance: 20_000_000n,
    period: 2_592_000,
    maxPayment: 5_000_000n,
    maxPayments: 5,
    expiresAt: 1_900_000_000,
    services: ["search"],
    paused: false,
    anchor: 1_700_000_000,
  });

  assert.deepEqual(decodeUsage({ period_start: 1_700_000_000, spent: 1_250_000n, count: 2 }), {
    periodStart: 1_700_000_000,
    spent: 1_250_000n,
    count: 2,
  });
  assert.deepEqual(decodeVerdict({
    rule: 0,
    over_by: 0n,
    allowance_left: 18_750_000n,
    period_spent: 1_250_000n,
    period_count: 2,
  }), {
    rule: 0,
    overBy: 0n,
    allowanceLeft: 18_750_000n,
    periodSpent: 1_250_000n,
    periodCount: 2,
  });
  assert.deepEqual(decodeReceipt({
    spender: "GSPENDER",
    service: "search",
    payee: "GPAYEE",
    amount: 2_500_000n,
    memo: "query",
    period_spent: 3_750_000n,
    allowance_left: 16_250_000n,
    at: 1_700_000_001,
  }), {
    spender: "GSPENDER",
    service: "search",
    payee: "GPAYEE",
    amount: 2_500_000n,
    memo: "query",
    periodSpent: 3_750_000n,
    allowanceLeft: 16_250_000n,
    at: 1_700_000_001,
  });
});

test("pay throws immediately when the submitted transaction fails on chain", async () => {
  const keypair = Keypair.random();
  const agent = new TeamAgent({ secret: keypair.secret() });
  const hash = "failed-transaction";
  agent.check = async () => ({
    rule: Rule.Ok,
    overBy: 0n,
    allowanceLeft: 1_000_000n,
    periodSpent: 0n,
    periodCount: 0,
  });
  agent.server = {
    getAccount: async () => new Account(agent.address, "1"),
    prepareTransaction: async () => ({ sign() {} }),
    sendTransaction: async () => ({ status: "PENDING", hash }),
    getTransaction: async () => ({ status: rpc.Api.GetTransactionStatus.FAILED }),
  };

  await assert.rejects(
    agent.pay({ service: "search", amount: "0.25" }),
    { message: `Transaction ${hash} failed on chain` },
  );
});
