/**
 * Stellar testnet backend: reads and writes the deployed team-account and
 * service-registry contracts through Soroban RPC, signing with Freighter.
 *
 * Every rule is enforced by the contract; this file only builds calls and
 * reads results. A call the contract refuses comes back as a ContractError
 * carrying the contract's own error code.
 */
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { requestAccess, signTransaction } from "@stellar/freighter-api";
import { Buffer } from "buffer";
import { ContractError } from "../engine/rules";
import type {
  Activity,
  AgentRule,
  ApprovalRequest,
  Backend,
  PayArgs,
  PayResult,
  Policy,
  PolicyInput,
  RequestStatus,
  Service,
  Snapshot,
  Usage,
  Verdict,
} from "../engine/types";

import type { TestnetConfig } from "./config";

const STATUS: RequestStatus[] = ["pending", "approved", "declined", "settled"];
const LOCAL_KEY = "ecorouter.testnet.local.v1";

interface LocalState {
  names: Record<string, string>;
  refused: Activity[];
  agentRules: AgentRule[];
}

function readLocal(): LocalState {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw, (_k, v) => (v && typeof v === "object" && "$b" in v ? BigInt(v.$b) : v));
  } catch {
    /* fall through */
  }
  return { names: {}, refused: [], agentRules: [] };
}

function writeLocal(s: LocalState): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? { $b: v.toString() } : v)));
  } catch {
    /* ignore */
  }
}

/** Pulls `Error(Contract, #8)` out of a simulation or submission error. */
export function contractErrorCode(message: string): number | null {
  const m = /Error\(Contract, #(\d+)\)/.exec(message);
  return m ? Number(m[1]) : null;
}

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const addr = (a: string) => new Address(a).toScVal();
const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
const u64 = (v: number) => nativeToScVal(BigInt(v), { type: "u64" });
const u32 = (v: number) => nativeToScVal(v, { type: "u32" });
const str = (s: string) => nativeToScVal(s, { type: "string" });

/** PolicyInput as the contract's struct: a map with keys in sorted order. */
export function policyInputScVal(p: PolicyInput): xdr.ScVal {
  const entries: Array<[string, xdr.ScVal]> = [
    ["allowance", i128(p.allowance)],
    ["expires_at", u64(p.expiresAt)],
    ["kind", u32(p.kind === "agent" ? 1 : 0)],
    ["label", str(p.label)],
    ["max_payment", i128(p.maxPayment)],
    ["max_payments", u32(p.maxPayments)],
    ["period", u64(p.period)],
    ["services", xdr.ScVal.scvVec(p.services.map(sym))],
  ];
  return xdr.ScVal.scvMap(entries.map(([k, v]) => new xdr.ScMapEntry({ key: sym(k), val: v })));
}

function toPolicy(raw: any): Policy {
  return {
    kind: Number(raw.kind) === 1 ? "agent" : "person",
    label: String(raw.label),
    allowance: BigInt(raw.allowance),
    period: Number(raw.period),
    maxPayment: BigInt(raw.max_payment),
    maxPayments: Number(raw.max_payments),
    expiresAt: Number(raw.expires_at),
    services: (raw.services as string[]).map(String),
    paused: Boolean(raw.paused),
    anchor: Number(raw.anchor),
  };
}

function toUsage(raw: any): Usage {
  return { periodStart: Number(raw.period_start), spent: BigInt(raw.spent), count: Number(raw.count) };
}

function toRequest(raw: any): ApprovalRequest {
  return {
    id: Number(raw.id),
    spender: String(raw.spender),
    service: String(raw.service),
    payee: String(raw.payee),
    amount: BigInt(raw.amount),
    memo: String(raw.memo),
    rule: Number(raw.rule),
    overBy: BigInt(raw.over_by),
    status: STATUS[Number(raw.status)] ?? "pending",
    createdAt: Number(raw.created_at),
    expiresAt: Number(raw.expires_at),
  };
}

function randomKey(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

export class TestnetBackend implements Backend {
  readonly mode = "testnet" as const;
  private server: rpc.Server;
  private account: Contract;
  private registry: Contract;
  private local = readLocal();
  /** A throwaway source for read-only simulations; it never signs or submits. */
  private readSource = new Account(Keypair.random().publicKey(), "0");

  constructor(private cfg: TestnetConfig, public me: string) {
    this.server = new rpc.Server(cfg.rpcUrl);
    this.account = new Contract(cfg.accountId);
    this.registry = new Contract(cfg.registryId);
  }

  static async connect(cfg: TestnetConfig): Promise<TestnetBackend> {
    const res = await requestAccess();
    if (res.error || !res.address) {
      throw new Error(res.error?.message || "Freighter did not share an address. Is the extension installed and unlocked?");
    }
    return new TestnetBackend(cfg, res.address);
  }

  // ------------------------------------------------------------- reading

  private async read(contract: Contract, method: string, ...args: xdr.ScVal[]): Promise<any> {
    const tx = new TransactionBuilder(this.readSource, { fee: BASE_FEE, networkPassphrase: this.cfg.networkPassphrase })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      const code = contractErrorCode(sim.error);
      if (code !== null) throw new ContractError(code);
      throw new Error(sim.error);
    }
    const ret = sim.result?.retval;
    return ret ? scValToNative(ret) : undefined;
  }

  async load(): Promise<Snapshot> {
    const [owner, paused, balance, spenders, services, requests, latest] = await Promise.all([
      this.read(this.account, "owner"),
      this.read(this.account, "paused"),
      this.read(this.account, "balance"),
      this.read(this.account, "spenders") as Promise<string[]>,
      this.read(this.registry, "list") as Promise<any[]>,
      this.read(this.account, "requests", u64(1), u32(200)) as Promise<any[]>,
      this.server.getLatestLedger(),
    ]);
    const spenderViews = await Promise.all(
      spenders.map(async (a) => {
        const [p, u] = await Promise.all([this.read(this.account, "policy", addr(a)), this.read(this.account, "usage", addr(a))]);
        return { address: a, policy: toPolicy(p), usage: toUsage(u) };
      }),
    );
    const names: Record<string, string> = { ...this.local.names };
    for (const s of spenderViews) names[s.address] ??= s.policy.label;
    names[owner] ??= "Owner";
    const activity = [...(await this.events(latest.sequence)), ...this.local.refused].sort((a, b) => b.at - a.at);
    return {
      mode: "testnet",
      now: Math.floor(Date.now() / 1000),
      account: { id: this.cfg.accountId, name: "Team account", owner, balance: BigInt(balance), paused: Boolean(paused) },
      me: this.me,
      spenders: spenderViews,
      services: services.map(
        (s): Service => ({ id: String(s.id), name: String(s.name), payee: String(s.payee), suspended: Boolean(s.suspended) }),
      ),
      requests: requests.map(toRequest).sort((a, b) => b.id - a.id),
      activity,
      agentRules: this.local.agentRules,
      names,
    };
  }

  /** Recent contract events (RPC keeps about a week of them). */
  private async events(latestLedger: number): Promise<Activity[]> {
    const startLedger = Math.max(1, latestLedger - 17_280 * 6);
    let res: rpc.Api.GetEventsResponse;
    try {
      res = await this.server.getEvents({ startLedger, filters: [{ type: "contract", contractIds: [this.cfg.accountId] }], limit: 200 });
    } catch {
      return [];
    }
    const out: Activity[] = [];
    for (const e of res.events) {
      const topics = e.topic.map((t) => scValToNative(t));
      const data = scValToNative(e.value) ?? {};
      const at = Math.floor(new Date(e.ledgerClosedAt).getTime() / 1000);
      const base = { id: e.id, at, txHash: e.txHash };
      if (topics[0] === "pay") {
        out.push({ ...base, kind: "paid", spender: String(topics[1]), service: String(topics[2]), amount: BigInt(data.amount), memo: String(data.memo), note: String(data.payee) });
      } else if (topics[0] === "request" && topics[1] === "filed") {
        out.push({ ...base, kind: "requested", requestId: Number(topics[2]), spender: String(data.spender), service: String(data.service), amount: BigInt(data.amount), rule: Number(data.rule), overBy: BigInt(data.over_by) });
      } else if (topics[0] === "request" && topics[1] === "decided") {
        out.push({ ...base, kind: Number(data.status) === 1 ? "approved" : "declined", requestId: Number(topics[2]) });
      } else if (topics[0] === "request" && topics[1] === "settled") {
        out.push({ ...base, kind: "settled", requestId: Number(topics[2]), amount: BigInt(data.amount), note: String(data.payee) });
      } else if (topics[0] === "policy") {
        const note = topics[1] === "set" ? "Policy set" : topics[1] === "removed" ? "Spender removed" : data.paused ? "Spender paused" : "Spender resumed";
        out.push({ ...base, kind: "policy", spender: String(topics[2]), note });
      } else if (topics[0] === "account" && topics[1] === "withdraw") {
        out.push({ ...base, kind: "withdraw", amount: BigInt(data.amount), note: String(data.to) });
      } else if (topics[0] === "account" && topics[1] === "paused") {
        out.push({ ...base, kind: "policy", note: data.paused ? "Account paused" : "Account resumed" });
      }
    }
    return out;
  }

  async check(spender: string, service: string, amount: bigint): Promise<Verdict> {
    const v = await this.read(this.account, "check", addr(spender), sym(service), i128(amount));
    return {
      rule: Number(v.rule),
      overBy: BigInt(v.over_by),
      allowanceLeft: BigInt(v.allowance_left),
      periodSpent: BigInt(v.period_spent),
      periodCount: Number(v.period_count),
    };
  }

  // ------------------------------------------------------------- writing

  private async invoke(contract: Contract, method: string, ...args: xdr.ScVal[]): Promise<{ hash: string; value: any }> {
    const source = await this.server.getAccount(this.me);
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.cfg.networkPassphrase })
      .addOperation(contract.call(method, ...args))
      .setTimeout(120)
      .build();
    let prepared;
    try {
      prepared = await this.server.prepareTransaction(tx);
    } catch (e) {
      const code = contractErrorCode(String((e as Error)?.message ?? e));
      if (code !== null) throw new ContractError(code);
      throw e;
    }
    const signed = await signTransaction(prepared.toXDR(), { networkPassphrase: this.cfg.networkPassphrase, address: this.me });
    if (signed.error) throw new Error(signed.error.message || "Signing was cancelled.");
    const final = TransactionBuilder.fromXDR(signed.signedTxXdr, this.cfg.networkPassphrase);
    const sent = await this.server.sendTransaction(final);
    if (sent.status === "ERROR") throw new Error(`The network rejected the transaction${sent.errorResult ? ` (${sent.errorResult.toXDR("base64")})` : ""}.`);
    const done = await this.server.pollTransaction(sent.hash, { attempts: 30 });
    if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      // The outcome is either a failure or unknown; never guess it was paid.
      throw new Error(`Transaction ${sent.hash} ${done.status === "NOT_FOUND" ? "was not confirmed in time — check the explorer before retrying" : "failed"}.`);
    }
    return { hash: sent.hash, value: done.returnValue ? scValToNative(done.returnValue) : undefined };
  }

  async pay(a: PayArgs): Promise<PayResult> {
    const verdict = await this.check(a.spender, a.service, a.amount);
    if (verdict.rule !== 0) {
      this.recordRefusal(a, verdict.rule, verdict.overBy);
      return { ok: false, rule: verdict.rule, overBy: verdict.overBy };
    }
    try {
      const { hash } = await this.invoke(this.account, "pay", addr(a.spender), sym(a.service), i128(a.amount), str(a.memo), xdr.ScVal.scvBytes(Buffer.from(randomKey())));
      return { ok: true, rule: 0, overBy: 0n, txHash: hash };
    } catch (e) {
      if (e instanceof ContractError) {
        this.recordRefusal(a, e.code, 0n);
        return { ok: false, rule: e.code, overBy: 0n };
      }
      throw e;
    }
  }

  private recordRefusal(a: PayArgs, rule: number, overBy: bigint): void {
    this.local.refused.unshift({ id: `local-${Date.now()}`, kind: "refused", at: Math.floor(Date.now() / 1000), spender: a.spender, service: a.service, amount: a.amount, memo: a.memo, rule, overBy, via: a.via, note: "Refused before submission; nothing reached the chain." });
    this.local.refused = this.local.refused.slice(0, 100);
    writeLocal(this.local);
  }

  async requestApproval(a: PayArgs): Promise<number> {
    const { value } = await this.invoke(this.account, "request_approval", addr(a.spender), sym(a.service), i128(a.amount), str(a.memo));
    return Number(value);
  }

  async approve(id: number): Promise<void> {
    await this.invoke(this.account, "approve", u64(id));
  }

  async decline(id: number): Promise<void> {
    await this.invoke(this.account, "decline", u64(id));
  }

  async settle(id: number): Promise<void> {
    await this.invoke(this.account, "settle", u64(id), addr(this.me));
  }

  async setPolicy(spender: string, input: PolicyInput, name?: string): Promise<void> {
    await this.invoke(this.account, "set_policy", addr(spender), policyInputScVal(input));
    if (name) {
      this.local.names[spender] = name;
      writeLocal(this.local);
    }
  }

  async setSpenderPaused(spender: string, paused: boolean): Promise<void> {
    await this.invoke(this.account, "set_spender_paused", addr(spender), xdr.ScVal.scvBool(paused));
  }

  async removeSpender(spender: string): Promise<void> {
    await this.invoke(this.account, "remove_spender", addr(spender));
  }

  async setAccountPaused(paused: boolean): Promise<void> {
    await this.invoke(this.account, "set_paused", xdr.ScVal.scvBool(paused));
  }

  async withdraw(to: string, amount: bigint): Promise<void> {
    await this.invoke(this.account, "withdraw", addr(to), i128(amount));
  }

  async saveAgentRule(rule: AgentRule): Promise<void> {
    const i = this.local.agentRules.findIndex((r) => r.id === rule.id);
    if (i >= 0) this.local.agentRules[i] = rule;
    else this.local.agentRules.push(rule);
    writeLocal(this.local);
  }

  async deleteAgentRule(id: string): Promise<void> {
    this.local.agentRules = this.local.agentRules.filter((r) => r.id !== id);
    writeLocal(this.local);
  }

  /** On testnet an agent signs with its own key, held by the agent worker, never by this page. */
  async runAgents(): Promise<number> {
    return 0;
  }
}
