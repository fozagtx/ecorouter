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
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { getNetwork, isConnected, requestAccess, signMessage, signTransaction } from "@stellar/freighter-api";
import { Buffer } from "buffer";
import { ContractError } from "../engine/rules";
import { mapRegistryListing, mapX402Transfers, type SacTransfer } from "../engine/marketplace";
import { collectEventPages } from "./event-pages";
import type {
  Activity,
  ApprovalRequest,
  Backend,
  GatewayListingStatus,
  JoinRequest,
  ListingInput,
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
}

function readLocal(): LocalState {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw, (_k, v) => (v && typeof v === "object" && "$b" in v ? BigInt(v.$b) : v));
  } catch {
    /* fall through */
  }
  return { names: {}, refused: [] };
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
export function policyInputScVal(p: PolicyInput, spender: string): xdr.ScVal {
  const entries: Array<[string, xdr.ScVal]> = [
    ["allowance", i128(p.allowance)],
    ["expires_at", u64(p.expiresAt)],
    ["kind", u32(p.kind === "agent" ? 1 : 0)],
    ["label", str(p.label)],
    ["max_payment", i128(p.maxPayment)],
    ["max_payments", u32(p.maxPayments)],
    ["period", u64(p.period)],
    ["services", xdr.ScVal.scvVec(p.services.map(sym))],
    ["signer", xdr.ScVal.scvBytes(Buffer.from(StrKey.decodeEd25519PublicKey(spender)))],
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
    signer: Buffer.from(raw.signer).toString("hex"),
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

function toJoinRequest(raw: any): JoinRequest {
  return { who: String(raw.who), label: String(raw.label), at: Number(raw.at) };
}

function randomKey(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

export class TestnetBackend implements Backend {
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
    const connection = await isConnected();
    if (!connection.isConnected) {
      throw new Error("Freighter isn't installed in this browser. Install it from freighter.app, then reload this page.");
    }
    const res = await requestAccess();
    if (res.error || !res.address) {
      throw new Error(res.error?.message || "Freighter did not share an address. Is the extension installed and unlocked?");
    }
    return TestnetBackend.connectAddress(cfg, res.address);
  }

  static async connectAddress(cfg: TestnetConfig, address: string): Promise<TestnetBackend> {
    const { network, networkPassphrase, error } = await getNetwork();
    if (error) throw new Error(error.message);
    if (networkPassphrase !== cfg.networkPassphrase) {
      throw new Error(`Freighter is on ${network}. Switch it to Testnet and try again.`);
    }
    return new TestnetBackend(cfg, address);
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
    const [owner, paused, balance, spenders, services, requests, joinRequests, latest] = await Promise.all([
      this.read(this.account, "owner"),
      this.read(this.account, "paused"),
      this.read(this.account, "balance"),
      this.read(this.account, "spenders") as Promise<string[]>,
      this.read(this.registry, "list") as Promise<any[]>,
      this.read(this.account, "requests", u64(1), u32(200)) as Promise<any[]>,
      this.read(this.account, "join_requests") as Promise<any[]>,
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
    const chainActivity = await this.events(latest.sequence);
    const mappedServices = services.map(mapRegistryListing);
    const x402Activity = await this.sacTransfers(latest.sequence, mappedServices, chainActivity);
    const activity = [...chainActivity, ...x402Activity, ...this.local.refused].sort((a, b) => b.at - a.at);
    return {
      now: Math.floor(Date.now() / 1000),
      account: { id: this.cfg.accountId, name: "Team account", owner, balance: BigInt(balance), paused: Boolean(paused) },
      me: this.me,
      spenders: spenderViews,
      services: mappedServices,
      joinRequests: joinRequests.map(toJoinRequest),
      requests: requests.map(toRequest).sort((a, b) => b.id - a.id),
      activity,
      names,
    };
  }

  /** Recent contract events retained by the RPC node. */
  private async events(latestLedger: number): Promise<Activity[]> {
    const { oldestLedger } = await this.server.getHealth();
    const startLedger = Math.max(oldestLedger + 1, latestLedger - 103_680);
    const events = await collectEventPages(
      (request) => this.server.getEvents(request),
      { startLedger, filters: [{ type: "contract", contractIds: [this.cfg.accountId] }], limit: 200 },
    );
    const out: Activity[] = [];
    for (const e of events) {
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

  private async sacTransfers(latestLedger: number, services: Service[], existing: Activity[]): Promise<Activity[]> {
    const { oldestLedger } = await this.server.getHealth();
    const startLedger = Math.max(oldestLedger + 1, latestLedger - 10_000);
    const events = await collectEventPages(
      (request) => this.server.getEvents(request),
      {
        startLedger,
        filters: [{
          type: "contract",
          contractIds: [this.cfg.usdcId],
          topics: [[sym("transfer").toXDR("base64"), addr(this.cfg.accountId).toXDR("base64"), "*", "*"]],
        }],
        limit: 200,
      },
    );
    const transfers: SacTransfer[] = events.flatMap((event) => {
      const topics = event.topic.map((topic) => String(scValToNative(topic)));
      if (topics[0] !== "transfer" || topics.length < 3) return [];
      try {
        return [{
          id: event.id,
          txHash: event.txHash,
          at: Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000),
          from: topics[1],
          to: topics[2],
          amount: BigInt(String(scValToNative(event.value))),
        }];
      } catch {
        return [];
      }
    });
    return mapX402Transfers(transfers, this.cfg.accountId, services, existing);
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
    await this.invoke(this.account, "set_policy", addr(spender), policyInputScVal(input, spender));
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

  async requestJoin(label: string): Promise<void> {
    await this.invoke(this.account, "request_join", addr(this.me), str(label));
  }

  async dismissJoin(who: string): Promise<void> {
    await this.invoke(this.account, "dismiss_join", addr(who));
  }

  async registerListing(input: ListingInput): Promise<void> {
    const url = this.cfg.gatewayUrl ? `${this.cfg.gatewayUrl.replace(/\/$/, "")}/a/${input.id}` : "";
    await this.invoke(
      this.registry,
      "register",
      addr(this.me),
      sym(input.id),
      str(input.name),
      str(input.task),
      sym(input.kind),
      addr(this.me),
      str(url),
      i128(input.price),
    );
  }

  async gatewayListings(): Promise<GatewayListingStatus[]> {
    if (!this.cfg.gatewayUrl) return [];
    const response = await fetch(`${this.cfg.gatewayUrl.replace(/\/$/, "")}/listings`);
    if (!response.ok) throw new Error(`Gateway returned HTTP ${response.status}.`);
    const value: unknown = await response.json();
    if (!Array.isArray(value)) throw new Error("Gateway returned an invalid listings response.");
    return value.flatMap((row): GatewayListingStatus[] => {
      if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.connected !== "boolean") return [];
      return [{ id: row.id, connected: row.connected }];
    });
  }

  async connectUpstream(id: string, upstream: { url: string; kind: "api" | "mcp"; authHeader?: string }): Promise<void> {
    if (!this.cfg.gatewayUrl) throw new Error("Gateway not deployed yet.");
    const body = JSON.stringify({
      url: upstream.url,
      kind: upstream.kind,
      ...(upstream.authHeader ? { authHeader: upstream.authHeader } : {}),
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyHash = await sha256Hex(body);
    const message = `ecorouter:upstream:${id}:${bodyHash}:${timestamp}`;
    const signed = await signMessage(message, { address: this.me, networkPassphrase: this.cfg.networkPassphrase });
    if (signed.error) throw new Error(signed.error.message || "Freighter could not sign the upstream connection.");
    if (signed.signerAddress && signed.signerAddress !== this.me) throw new Error("Freighter signed with a different account.");
    if (!signed.signedMessage) throw new Error("Freighter did not return a signature.");
    const signature = typeof signed.signedMessage === "string"
      ? signed.signedMessage
      : Buffer.from(signed.signedMessage).toString("base64");
    const response = await fetch(`${this.cfg.gatewayUrl.replace(/\/$/, "")}/listings/${encodeURIComponent(id)}/upstream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Stellar-Address": this.me,
        "X-Stellar-Signature": signature,
        "X-Timestamp": String(timestamp),
      },
      body,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: unknown } | null;
      throw new Error(typeof result?.error === "string" ? result.error : `Gateway returned HTTP ${response.status}.`);
    }
  }

  async setAccountPaused(paused: boolean): Promise<void> {
    await this.invoke(this.account, "set_paused", xdr.ScVal.scvBool(paused));
  }

  async withdraw(to: string, amount: bigint): Promise<void> {
    await this.invoke(this.account, "withdraw", addr(to), i128(amount));
  }

  async deposit(amount: bigint): Promise<void> {
    await this.invoke(new Contract(this.cfg.usdcId), "transfer", addr(this.me), addr(this.cfg.accountId), i128(amount));
  }

}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
