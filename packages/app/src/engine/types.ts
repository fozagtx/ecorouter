/** App shapes that mirror the team-account contract types. */

export type SpenderKind = "person" | "agent";

export interface PolicyInput {
  kind: SpenderKind;
  label: string;
  allowance: bigint;
  /** Seconds. */
  period: number;
  maxPayment: bigint;
  maxPayments: number;
  /** Unix seconds. */
  expiresAt: number;
  services: string[];
}

export interface Policy extends PolicyInput {
  paused: boolean;
  /** Periods are fixed windows counted from this timestamp. */
  anchor: number;
}

export interface Usage {
  periodStart: number;
  spent: bigint;
  count: number;
}

export interface Spender {
  address: string;
  policy: Policy;
  usage: Usage;
}

export interface Service {
  id: string;
  name: string;
  payee: string;
  suspended: boolean;
  /** Words the assistant can match against. Display-only; not on chain. */
  tags?: string[];
}

export type RequestStatus = "pending" | "approved" | "declined" | "settled";

export interface ApprovalRequest {
  id: number;
  spender: string;
  service: string;
  payee: string;
  amount: bigint;
  memo: string;
  rule: number;
  overBy: bigint;
  status: RequestStatus;
  createdAt: number;
  expiresAt: number;
}

export interface Verdict {
  rule: number;
  overBy: bigint;
  allowanceLeft: bigint;
  periodSpent: bigint;
  periodCount: number;
}

export type ActivityKind =
  | "paid"
  | "refused"
  | "requested"
  | "approved"
  | "declined"
  | "settled"
  | "policy"
  | "deposit"
  | "withdraw";

export interface Activity {
  id: string;
  kind: ActivityKind;
  at: number;
  spender?: string;
  service?: string;
  amount?: bigint;
  memo?: string;
  rule?: number;
  overBy?: bigint;
  requestId?: number;
  txHash?: string;
  /** What submitted it: a person in the app, the assistant draft, or an agent schedule. */
  via?: "app" | "assistant" | "agent";
  note?: string;
}

export type Cadence = "hour" | "day" | "week";

export const DAY = 86_400;
export const MONTH = 30 * DAY;
export const CADENCE_SECS: Record<Cadence, number> = { hour: 3_600, day: DAY, week: 7 * DAY };

export interface AgentRule {
  id: string;
  agent: string;
  service: string;
  amount: bigint;
  every: Cadence;
  memo: string;
  enabled: boolean;
  lastRun?: number;
}

export interface Snapshot {
  now: number;
  account: {
    id: string;
    name: string;
    owner: string;
    balance: bigint;
    paused: boolean;
  };
  /** Who is signed in / acting. */
  me: string;
  spenders: Spender[];
  services: Service[];
  requests: ApprovalRequest[];
  activity: Activity[];
  agentRules: AgentRule[];
  /** Display names for addresses (owner, people, agents). */
  names: Record<string, string>;
}

export interface PayArgs {
  spender: string;
  service: string;
  amount: bigint;
  memo: string;
  via?: Activity["via"];
}

export interface PayResult {
  ok: boolean;
  rule: number;
  overBy: bigint;
  txHash?: string;
}

export interface Backend {
  load(): Promise<Snapshot>;
  check(spender: string, service: string, amount: bigint): Promise<Verdict>;
  pay(args: PayArgs): Promise<PayResult>;
  requestApproval(args: PayArgs): Promise<number>;
  approve(id: number): Promise<void>;
  decline(id: number): Promise<void>;
  settle(id: number): Promise<void>;
  setPolicy(spender: string, input: PolicyInput, name?: string): Promise<void>;
  setSpenderPaused(spender: string, paused: boolean): Promise<void>;
  removeSpender(spender: string): Promise<void>;
  setAccountPaused(paused: boolean): Promise<void>;
  withdraw(to: string, amount: bigint): Promise<void>;
  deposit(amount: bigint): Promise<void>;
  saveAgentRule(rule: AgentRule): Promise<void>;
  deleteAgentRule(id: string): Promise<void>;
  /** Runs agent schedules that are due. Returns how many payments were attempted. */
  runAgents(force?: string): Promise<number>;
}
