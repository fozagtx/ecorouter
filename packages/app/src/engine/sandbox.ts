/**
 * Sandbox backend: a team account that lives in this browser, with test
 * dollars. It runs the same rules as the contract (see ./policy.ts) so the
 * product can be tried without a wallet.
 */
import { encodeStrKey } from "../lib/strkey";
import { usd } from "../lib/money";
import { currentUsage, evaluate, resolve, validatePolicy, verdict } from "./policy";
import { ContractError, EXCEPTION_ELIGIBLE, Rule } from "./rules";
import type {
  Activity,
  AgentRule,
  ApprovalRequest,
  Backend,
  Cadence,
  PayArgs,
  PayResult,
  Policy,
  PolicyInput,
  Service,
  Snapshot,
  Usage,
  Verdict,
} from "./types";

export const DAY = 86_400;
export const MONTH = 30 * DAY;
export const REQUEST_TTL = 7 * DAY;
export const CADENCE_SECS: Record<Cadence, number> = { hour: 3_600, day: DAY, week: 7 * DAY };

const STORAGE_KEY = "ecorouter.sandbox.v1";

export interface SandboxState {
  version: 1;
  timeOffset: number;
  accountId: string;
  accountName: string;
  owner: string;
  me: string;
  paused: boolean;
  balance: bigint;
  order: string[];
  policies: Record<string, Policy>;
  usage: Record<string, Usage>;
  services: Service[];
  requests: ApprovalRequest[];
  nextRequest: number;
  activity: Activity[];
  agentRules: AgentRule[];
  names: Record<string, string>;
  usedKeys: string[];
}

export interface Store {
  get(): string | null;
  set(value: string): void;
  clear(): void;
}

export const browserStore: Store = {
  get: () => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  set: (v) => {
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* private mode: state lives for this tab only */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
};

export function memoryStore(): Store {
  let v: string | null = null;
  return { get: () => v, set: (x) => (v = x), clear: () => (v = null) };
}

/** Deterministic, valid-looking Stellar addresses for the demo cast. */
export function demoAddress(seed: string, contract = false): string {
  const bytes = new Uint8Array(32);
  let h = 2166136261;
  for (let i = 0; i < 32; i++) {
    for (const c of seed + i) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    bytes[i] = h & 0xff;
  }
  return encodeStrKey(contract ? "contract" : "account", bytes);
}

function txHash(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function serialize(s: SandboxState): string {
  return JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? { $b: v.toString() } : v));
}

function deserialize(raw: string): SandboxState {
  return JSON.parse(raw, (_k, v) => (v && typeof v === "object" && "$b" in v ? BigInt(v.$b) : v));
}

export const CAST = {
  owner: demoAddress("ada"),
  marcus: demoAddress("marcus"),
  scout: demoAddress("scout"),
  atlas: demoAddress("atlas"),
};

export function seedState(now: number): SandboxState {
  const svc = (id: string, name: string, tags: string[], suspended = false): Service => ({
    id,
    name,
    payee: demoAddress(`payee-${id}`),
    suspended,
    tags,
  });
  const services: Service[] = [
    svc("inference", "Inference credits", ["inference", "model", "models", "llm", "tokens", "credits", "ai", "completion", "chat"]),
    svc("search", "Web search API", ["search", "web", "serp", "query", "queries", "lookup"]),
    svc("data", "Market data feed", ["data", "market", "prices", "feed", "quotes", "pricing"]),
    svc("gpu", "GPU hours", ["gpu", "compute", "training", "hours", "cluster", "fine-tune", "finetune"]),
    svc("storage", "Object storage", ["storage", "bucket", "files", "backup", "backups", "disk"]),
    svc("geocode", "Geocoding API", ["geocode", "geocoding", "maps", "address", "location"], true),
  ];
  const anchor = now - 12 * DAY;
  const expires = now + 180 * DAY;
  const policy = (p: Omit<Policy, "paused" | "anchor" | "period" | "expiresAt">): Policy => ({
    ...p,
    period: MONTH,
    expiresAt: expires,
    paused: false,
    anchor,
  });
  const s: SandboxState = {
    version: 1,
    timeOffset: 0,
    accountId: demoAddress("team-account", true),
    accountName: "Northwind Labs",
    owner: CAST.owner,
    me: CAST.owner,
    paused: false,
    balance: usd(5_000),
    order: [CAST.owner, CAST.marcus, CAST.scout, CAST.atlas],
    policies: {
      [CAST.owner]: policy({
        kind: "person",
        label: "Ada",
        allowance: usd(2_000),
        maxPayment: usd(500),
        maxPayments: 40,
        services: ["inference", "gpu", "search", "data", "storage"],
      }),
      [CAST.marcus]: policy({
        kind: "person",
        label: "Marcus",
        allowance: usd(1_000),
        maxPayment: usd(250),
        maxPayments: 20,
        // "translate" is on Marcus's list but was never registered: the registry refuses it.
        services: ["inference", "search", "data", "translate"],
      }),
      [CAST.scout]: policy({
        kind: "agent",
        label: "Scout",
        allowance: usd(300),
        maxPayment: usd(25),
        maxPayments: 60,
        services: ["search", "data"],
      }),
      [CAST.atlas]: policy({
        kind: "agent",
        label: "Atlas",
        allowance: usd(500),
        maxPayment: usd(60),
        maxPayments: 30,
        services: ["inference", "storage"],
      }),
    },
    usage: {},
    services,
    requests: [],
    nextRequest: 1,
    activity: [],
    agentRules: [
      { id: "r-scout", agent: CAST.scout, service: "search", amount: usd(4), every: "day", memo: "Daily research queries", enabled: true, lastRun: now - 20 * 3600 },
      { id: "r-atlas", agent: CAST.atlas, service: "storage", amount: usd(12), every: "week", memo: "Weekly backup storage", enabled: true, lastRun: now - 3 * DAY },
    ],
    names: {
      [CAST.owner]: "Ada",
      [CAST.marcus]: "Marcus",
      [CAST.scout]: "Scout",
      [CAST.atlas]: "Atlas",
    },
    usedKeys: [],
  };
  s.activity.push({ id: "a-deposit", kind: "deposit", at: anchor, amount: usd(5_000), note: "Owner funded the account", txHash: txHash() });

  // A believable history, produced by the same rules the app enforces.
  const history: Array<[number, string, string, number, string, Activity["via"]]> = [
    [11.2, CAST.marcus, "inference", 120, "Inference credits for the eval run", "app"],
    [9.5, CAST.owner, "gpu", 380, "Fine-tune, batch 3", "app"],
    [8.0, CAST.scout, "search", 4, "Daily research queries", "agent"],
    [7.0, CAST.scout, "search", 4, "Daily research queries", "agent"],
    [6.4, CAST.atlas, "inference", 45, "Support summarizer top-up", "agent"],
    [6.0, CAST.scout, "search", 4, "Daily research queries", "agent"],
    [5.0, CAST.scout, "search", 4, "Daily research queries", "agent"],
    [4.1, CAST.marcus, "search", 60, "Competitor scan", "assistant"],
    [4.0, CAST.scout, "search", 4, "Daily research queries", "agent"],
    [3.0, CAST.atlas, "storage", 12, "Weekly backup storage", "agent"],
    [3.0, CAST.scout, "search", 4, "Daily research queries", "agent"],
    [2.6, CAST.owner, "data", 140, "Quarterly pricing data", "app"],
    [2.0, CAST.scout, "search", 4, "Daily research queries", "agent"],
    [1.2, CAST.atlas, "inference", 75, "Batch summaries", "agent"],
    [1.0, CAST.scout, "search", 4, "Daily research queries", "agent"],
  ];
  for (const [daysAgo, spender, service, dollars, memo, via] of history) {
    payAt(s, { spender, service, amount: usd(dollars), memo, via }, Math.round(now - daysAgo * DAY));
  }
  // One held payment waiting on the owner, filed by Marcus.
  const heldAt = Math.round(now - 0.4 * DAY);
  payAt(s, { spender: CAST.marcus, service: "inference", amount: usd(420), memo: "Annual inference prepay", via: "app" }, heldAt);
  fileAt(s, { spender: CAST.marcus, service: "inference", amount: usd(420), memo: "Annual inference prepay", via: "app" }, heldAt + 30);
  s.activity.sort((a, b) => b.at - a.at);
  return s;
}

/** Applies `pay` to the state at time `at`. Records the outcome either way. */
function payAt(s: SandboxState, a: PayArgs, at: number): PayResult {
  const key = `${a.spender}:${at}:${Math.random()}`;
  const r = evaluate({
    accountPaused: s.paused,
    policy: s.policies[a.spender],
    storedUsage: s.usage[a.spender],
    service: a.service,
    amount: a.amount,
    now: at,
    keyUsed: s.usedKeys.includes(key),
  });
  let rule: number = r.ok ? Rule.Ok : r.rule;
  let payee = "";
  if (r.ok) {
    const res = resolve(s.services, a.service);
    if ("rule" in res) rule = res.rule;
    else if (s.balance < a.amount) rule = Rule.InsufficientFunds;
    else payee = res.payee;
  }
  if (!r.ok || rule !== Rule.Ok) {
    s.activity.unshift({
      id: `a-${at}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "refused",
      at,
      spender: a.spender,
      service: a.service,
      amount: a.amount,
      memo: a.memo,
      rule,
      overBy: r.ok ? 0n : r.overBy,
      via: a.via,
    });
    return { ok: false, rule, overBy: r.ok ? 0n : r.overBy };
  }
  const usage = { ...r.usage, spent: r.usage.spent + a.amount, count: r.usage.count + 1 };
  s.usage[a.spender] = usage;
  s.usedKeys.push(key);
  s.balance -= a.amount;
  const hash = txHash();
  s.activity.unshift({
    id: `a-${hash.slice(0, 12)}`,
    kind: "paid",
    at,
    spender: a.spender,
    service: a.service,
    amount: a.amount,
    memo: a.memo,
    txHash: hash,
    via: a.via,
    note: payee,
  });
  return { ok: true, rule: Rule.Ok, overBy: 0n, txHash: hash };
}

function fileAt(s: SandboxState, a: PayArgs, at: number): number {
  const r = evaluate({
    accountPaused: s.paused,
    policy: s.policies[a.spender],
    storedUsage: s.usage[a.spender],
    service: a.service,
    amount: a.amount,
    now: at,
  });
  if (r.ok) throw new ContractError(Rule.NoExceptionNeeded);
  if (!EXCEPTION_ELIGIBLE.has(r.rule)) throw new ContractError(r.rule);
  if (s.policies[a.spender]?.kind === "agent") throw new ContractError(Rule.AgentCannotRequest);
  const res = resolve(s.services, a.service);
  if ("rule" in res) throw new ContractError(res.rule);
  const id = s.nextRequest++;
  s.requests.unshift({
    id,
    spender: a.spender,
    service: a.service,
    payee: res.payee,
    amount: a.amount,
    memo: a.memo,
    rule: r.rule,
    overBy: r.overBy,
    status: "pending",
    createdAt: at,
    expiresAt: at + REQUEST_TTL,
  });
  s.activity.unshift({ id: `a-req-${id}`, kind: "requested", at, spender: a.spender, service: a.service, amount: a.amount, memo: a.memo, rule: r.rule, overBy: r.overBy, requestId: id, via: a.via });
  return id;
}

export class SandboxBackend implements Backend {
  readonly mode = "sandbox" as const;
  private s: SandboxState;

  constructor(private store: Store = browserStore, private clock: () => number = () => Math.floor(Date.now() / 1000)) {
    const raw = store.get();
    let state: SandboxState | null = null;
    if (raw) {
      try {
        state = deserialize(raw);
        if (state.version !== 1) state = null;
      } catch {
        state = null;
      }
    }
    this.s = state ?? seedState(clock());
    this.save();
  }

  static exists(store: Store = browserStore): boolean {
    return store.get() !== null;
  }

  reset(): void {
    this.s = seedState(this.clock());
    this.save();
  }

  destroy(): void {
    this.store.clear();
  }

  now(): number {
    return this.clock() + this.s.timeOffset;
  }

  /** Sandbox only: moves the account's clock forward, e.g. into the next period. */
  advance(seconds: number): void {
    this.s.timeOffset += seconds;
    this.save();
  }

  /** Sandbox only: switch which member of the team you are acting as. */
  actAs(address: string): void {
    this.s.me = address;
    this.save();
  }

  /** Sandbox only: add test dollars. */
  deposit(amount: bigint): void {
    this.s.balance += amount;
    this.s.activity.unshift({ id: `a-dep-${this.now()}`, kind: "deposit", at: this.now(), amount, txHash: txHash(), note: "Test dollars added" });
    this.save();
  }

  async load(): Promise<Snapshot> {
    const now = this.now();
    const s = this.s;
    return {
      mode: "sandbox",
      now,
      account: { id: s.accountId, name: s.accountName, owner: s.owner, balance: s.balance, paused: s.paused },
      me: s.me,
      spenders: s.order
        .filter((a) => s.policies[a])
        .map((address) => ({
          address,
          policy: s.policies[address],
          usage: currentUsage(s.policies[address], s.usage[address], now),
        })),
      services: s.services,
      requests: s.requests.map((r) => r),
      activity: s.activity.slice(0, 300),
      agentRules: s.agentRules,
      names: s.names,
    };
  }

  async check(spender: string, service: string, amount: bigint): Promise<Verdict> {
    return verdict({
      accountPaused: this.s.paused,
      policy: this.s.policies[spender],
      storedUsage: this.s.usage[spender],
      service,
      amount,
      now: this.now(),
      services: this.s.services,
      balance: this.s.balance,
    });
  }

  async pay(a: PayArgs): Promise<PayResult> {
    if (a.via !== "agent" && a.spender !== this.s.me) throw new ContractError(Rule.NotAuthorized);
    const r = payAt(this.s, a, this.now());
    this.save();
    return r;
  }

  async requestApproval(a: PayArgs): Promise<number> {
    if (a.spender !== this.s.me) throw new ContractError(Rule.NotAuthorized);
    const id = fileAt(this.s, a, this.now());
    this.save();
    return id;
  }

  async approve(id: number): Promise<void> {
    this.ownerOnly();
    const r = this.request(id);
    if (r.status !== "pending") throw new ContractError(Rule.RequestNotPending);
    if (this.now() >= r.expiresAt) throw new ContractError(Rule.RequestExpired);
    r.status = "approved";
    this.log({ kind: "approved", requestId: id, spender: r.spender, service: r.service, amount: r.amount });
  }

  async decline(id: number): Promise<void> {
    this.ownerOnly();
    const r = this.request(id);
    if (r.status !== "pending" && r.status !== "approved") throw new ContractError(Rule.RequestNotPending);
    r.status = "declined";
    this.log({ kind: "declined", requestId: id, spender: r.spender, service: r.service, amount: r.amount });
  }

  async settle(id: number): Promise<void> {
    const r = this.request(id);
    if (this.s.me !== this.s.owner && this.s.me !== r.spender) throw new ContractError(Rule.NotAuthorized);
    if (this.s.paused) throw new ContractError(Rule.AccountPaused);
    if (r.status !== "approved") throw new ContractError(Rule.RequestNotApproved);
    if (this.now() >= r.expiresAt) throw new ContractError(Rule.RequestExpired);
    const res = resolve(this.s.services, r.service);
    if ("rule" in res) throw new ContractError(res.rule);
    if (res.payee !== r.payee) throw new ContractError(Rule.PayeeChanged);
    if (this.s.balance < r.amount) throw new ContractError(Rule.InsufficientFunds);
    r.status = "settled";
    this.s.balance -= r.amount;
    this.log({ kind: "settled", requestId: id, spender: r.spender, service: r.service, amount: r.amount, memo: r.memo, txHash: txHash(), note: r.payee });
  }

  async setPolicy(spender: string, input: PolicyInput, name?: string): Promise<void> {
    this.ownerOnly();
    const now = this.now();
    if (!validatePolicy(input, now)) throw new ContractError(Rule.InvalidPolicy);
    const existing = this.s.policies[spender];
    this.s.policies[spender] = {
      ...input,
      paused: existing?.paused ?? false,
      anchor: existing?.anchor ?? now,
    };
    if (!existing) {
      this.s.order.push(spender);
      this.s.usage[spender] = { periodStart: now, spent: 0n, count: 0 };
    }
    if (name) this.s.names[spender] = name;
    this.log({ kind: "policy", spender, note: existing ? "Policy updated" : "Spender added" });
  }

  async setSpenderPaused(spender: string, paused: boolean): Promise<void> {
    this.ownerOnly();
    const p = this.s.policies[spender];
    if (!p) throw new ContractError(Rule.UnknownSpender);
    p.paused = paused;
    this.log({ kind: "policy", spender, note: paused ? "Spender paused" : "Spender resumed" });
  }

  async removeSpender(spender: string): Promise<void> {
    this.ownerOnly();
    if (!this.s.policies[spender]) throw new ContractError(Rule.UnknownSpender);
    delete this.s.policies[spender];
    delete this.s.usage[spender];
    this.s.order = this.s.order.filter((a) => a !== spender);
    this.s.agentRules = this.s.agentRules.filter((r) => r.agent !== spender);
    this.log({ kind: "policy", spender, note: "Spender removed" });
  }

  async setAccountPaused(paused: boolean): Promise<void> {
    this.ownerOnly();
    this.s.paused = paused;
    this.log({ kind: "policy", note: paused ? "Account paused" : "Account resumed" });
  }

  async withdraw(to: string, amount: bigint): Promise<void> {
    this.ownerOnly();
    if (amount <= 0n) throw new ContractError(Rule.InvalidAmount);
    if (this.s.balance < amount) throw new ContractError(Rule.InsufficientFunds);
    this.s.balance -= amount;
    this.log({ kind: "withdraw", amount, note: to, txHash: txHash() });
  }

  async saveAgentRule(rule: AgentRule): Promise<void> {
    this.ownerOnly();
    if (this.s.policies[rule.agent]?.kind !== "agent") throw new ContractError(Rule.UnknownSpender);
    const i = this.s.agentRules.findIndex((r) => r.id === rule.id);
    if (i >= 0) this.s.agentRules[i] = rule;
    else this.s.agentRules.push(rule);
    this.save();
  }

  async deleteAgentRule(id: string): Promise<void> {
    this.ownerOnly();
    this.s.agentRules = this.s.agentRules.filter((r) => r.id !== id);
    this.save();
  }

  async runAgents(force?: string): Promise<number> {
    const now = this.now();
    let attempts = 0;
    for (const rule of this.s.agentRules) {
      const due = rule.enabled && (rule.lastRun === undefined || now - rule.lastRun >= CADENCE_SECS[rule.every]);
      if (!(due || rule.id === force)) continue;
      // An agent's refused payment stops there: it is recorded, never filed.
      payAt(this.s, { spender: rule.agent, service: rule.service, amount: rule.amount, memo: rule.memo, via: "agent" }, now);
      rule.lastRun = now;
      attempts++;
    }
    if (attempts) this.save();
    return attempts;
  }

  // ------------------------------------------------------------------

  private ownerOnly(): void {
    if (this.s.me !== this.s.owner) throw new ContractError(Rule.NotAuthorized);
  }

  private request(id: number): ApprovalRequest {
    const r = this.s.requests.find((x) => x.id === id);
    if (!r) throw new ContractError(Rule.UnknownRequest);
    return r;
  }

  private log(a: Omit<Activity, "id" | "at">): void {
    const at = this.now();
    this.s.activity.unshift({ id: `a-${a.kind}-${at}-${Math.random().toString(36).slice(2, 8)}`, at, ...a });
    this.save();
  }

  private save(): void {
    this.store.set(serialize(this.s));
  }
}
