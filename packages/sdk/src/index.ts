import { createHash, randomBytes } from "node:crypto";
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { decodePolicy, decodeReceipt, decodeUsage, decodeVerdict } from "./codec.js";
import { formatUsdc, parseUsdc } from "./money.js";
import { payX402 } from "./x402.js";

export { payX402 } from "./x402.js";

export const TESTNET = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  teamAccount: "CB3IBFXCPR6N5CJTE4WNUEAMPPIVJ2NTR7WM5AO2RYIDKILAEKEP4HY2",
  registry: "CCM6XHG3JPZHKYD7ZY2GWRVRQHLU5IQ6RNX3OOWSUB7MWQWL57PUOYTM",
  usdc: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  explorer: "https://stellar.expert/explorer/testnet",
} as const;

export interface AgentConfig {
  secret: string;
  teamAccount?: string;
  registry?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
}

export interface Policy {
  kind: "person" | "agent";
  signer: string;
  label: string;
  allowance: bigint;
  period: number;
  maxPayment: bigint;
  maxPayments: number;
  expiresAt: number;
  services: string[];
  paused: boolean;
  anchor: number;
}

export interface Usage {
  periodStart: number;
  spent: bigint;
  count: number;
}

export interface Receipt {
  spender: string;
  service: string;
  payee: string;
  amount: bigint;
  memo: string;
  periodSpent: bigint;
  allowanceLeft: bigint;
  at: number;
}

export interface Verdict {
  rule: number;
  overBy: bigint;
  allowanceLeft: bigint;
  periodSpent: bigint;
  periodCount: number;
}

export type PayOutcome =
  | { status: "paid"; key: string; txHash: string; explorerUrl: string; receipt: Receipt }
  | { status: "refused"; key: string; rule: number; reason: string; overBy: bigint }
  | { status: "pending"; key: string; txHash: string };

export const Rule = {
  Ok: 0,
  AccountPaused: 1,
  UnknownSpender: 2,
  SpenderPaused: 3,
  PolicyExpired: 4,
  InvalidAmount: 5,
  ServiceNotAllowed: 6,
  DuplicatePayment: 7,
  OverPaymentCap: 8,
  OverFrequency: 9,
  OverAllowance: 10,
  UnknownService: 11,
  ServiceSuspended: 12,
  InsufficientFunds: 13,
  InvalidPolicy: 14,
  UnknownRequest: 15,
  RequestNotPending: 16,
  RequestNotApproved: 17,
  RequestExpired: 18,
  PayeeChanged: 19,
  NotAuthorized: 20,
  NoExceptionNeeded: 21,
  NotEligibleForException: 22,
  AgentCannotRequest: 23,
  RegistryUnavailable: 24,
  NoPendingOwner: 25,
} as const;

const RULE_REASONS: Record<number, string> = {
  [Rule.AccountPaused]: "Account paused",
  [Rule.UnknownSpender]: "Not a spender",
  [Rule.SpenderPaused]: "Spender paused",
  [Rule.PolicyExpired]: "Policy expired",
  [Rule.InvalidAmount]: "Invalid amount",
  [Rule.ServiceNotAllowed]: "Service not on the list",
  [Rule.DuplicatePayment]: "Already submitted",
  [Rule.OverPaymentCap]: "Over the per-payment cap",
  [Rule.OverFrequency]: "Too many payments this period",
  [Rule.OverAllowance]: "Over the allowance",
  [Rule.UnknownService]: "Unknown service",
  [Rule.ServiceSuspended]: "Service suspended",
  [Rule.InsufficientFunds]: "Not enough in the account",
  [Rule.InvalidPolicy]: "Invalid policy",
  [Rule.UnknownRequest]: "Unknown request",
  [Rule.RequestNotPending]: "Already decided",
  [Rule.RequestNotApproved]: "Not approved",
  [Rule.RequestExpired]: "Request expired",
  [Rule.PayeeChanged]: "Payee changed",
  [Rule.NotAuthorized]: "Not allowed",
  [Rule.NoExceptionNeeded]: "Within the rules",
  [Rule.NotEligibleForException]: "Not eligible",
  [Rule.AgentCannotRequest]: "Agents cannot ask",
  [Rule.RegistryUnavailable]: "Registry unavailable",
  [Rule.NoPendingOwner]: "No pending owner",
};

export function ruleReason(code: number): string {
  return RULE_REASONS[code] ?? `Contract error #${code}`;
}

export function contractErrorCode(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /Error\(Contract,\s*#(\d+)\)/i.exec(message);
  return match ? Number(match[1]) : null;
}

export function scheduleKey(team: string, agent: string, service: string, slot: number): string {
  return createHash("sha256").update(`ecorouter:v1:${team}:${agent}:${service}:${slot}`).digest("hex");
}

export { formatUsdc, parseUsdc };

const symbol = (value: string) => xdr.ScVal.scvSymbol(value);
const address = (value: string) => new Address(value).toScVal();
const i128 = (value: bigint) => nativeToScVal(value, { type: "i128" });
const string = (value: string) => nativeToScVal(value, { type: "string" });
const keyScVal = (key: string) => xdr.ScVal.scvBytes(Buffer.from(key, "hex"));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeAmount(amount: string | bigint): bigint {
  return typeof amount === "bigint" ? amount : parseUsdc(amount);
}

function validateKey(key: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error("Payment key must be 64 hexadecimal characters.");
}

function isNetworkError(error: unknown): boolean {
  const candidate = error as { message?: unknown; code?: unknown; status?: unknown };
  const message = `${String(candidate?.message ?? error)} ${String(candidate?.code ?? "")} ${String(candidate?.status ?? "")}`.toLowerCase();
  return /fetch failed|network|socket|econn|etimedout|enotfound|eai_again|timeout|temporar|connection|429|502|503|504/.test(message);
}

async function retryRead<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 2 || !isNetworkError(error)) throw error;
      await wait(250 * 2 ** attempt);
    }
  }
}

export class TeamAgent {
  readonly address: string;
  private readonly keypair: Keypair;
  private readonly server: rpc.Server;
  private readonly contract: Contract;
  private readonly teamAccount: string;
  private readonly registry: string;
  private readonly networkPassphrase: string;
  private readonly readSource: Account;

  constructor(cfg: AgentConfig) {
    this.keypair = Keypair.fromSecret(cfg.secret);
    this.address = this.keypair.publicKey();
    this.teamAccount = cfg.teamAccount ?? TESTNET.teamAccount;
    this.registry = cfg.registry ?? TESTNET.registry;
    this.networkPassphrase = cfg.networkPassphrase ?? TESTNET.networkPassphrase;
    this.server = new rpc.Server(cfg.rpcUrl ?? TESTNET.rpcUrl);
    this.contract = new Contract(this.teamAccount);
    this.readSource = new Account(Keypair.random().publicKey(), "0");
  }

  private async read(method: string, ...args: xdr.ScVal[]): Promise<unknown> {
    return this.readFrom(this.teamAccount, method, ...args);
  }

  private async readFrom(contractId: string, method: string, ...args: xdr.ScVal[]): Promise<unknown> {
    const tx = new TransactionBuilder(this.readSource, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const result = await retryRead(() => this.server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(result)) {
      const code = contractErrorCode(result.error);
      if (code !== null) throw new Error(`Error(Contract, #${code})`);
      throw new Error(result.error);
    }
    return result.result?.retval ? scValToNative(result.result.retval) : undefined;
  }

  async fetch(url: string | URL, init?: RequestInit): Promise<{
    response: Response;
    payment: { tx: string; explorerUrl: string } | null;
    resourceFeeStroops: string;
    rule?: number;
  }> {
    const result = await payX402(String(url), {
      secret: this.keypair.secret(),
      teamAccount: this.teamAccount,
      init,
      beforeSign: async (requirement) => {
        let service: unknown;
        try {
          service = await this.readFrom(this.registry, "by_payee", address(requirement.payTo));
        } catch {
          return Rule.UnknownService;
        }
        if (typeof service !== "string" || !service) return Rule.UnknownService;
        const rule = (await this.check(service, BigInt(requirement.amount))).rule;
        return rule === Rule.Ok ? undefined : rule;
      },
    });
    const transaction = result.paymentResponse?.transaction;
    return {
      response: result.response,
      payment: transaction
        ? { tx: transaction, explorerUrl: `${TESTNET.explorer}/tx/${transaction}` }
        : null,
      resourceFeeStroops: result.resourceFeeStroops,
      ...(result.rule !== undefined ? { rule: result.rule } : {}),
    };
  }

  async mcpCall(
    url: string | URL,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ response: Response; payment: { tx: string; explorerUrl: string } | null; resourceFeeStroops: string; rule?: number }> {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Protocol-Version": "2025-03-26",
    };
    const initialized = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ecorouter-agent", version: "0.1.0" } },
      }),
    });
    if (!initialized.ok) throw new Error(`MCP initialize failed: HTTP ${initialized.status}`);
    const session = initialized.headers.get("Mcp-Session-Id");
    const callHeaders = { ...headers, ...(session ? { "Mcp-Session-Id": session } : {}) };
    return this.fetch(url, {
      method: "POST",
      headers: callHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }),
    });
  }

  async check(service: string, amount: string | bigint): Promise<Verdict> {
    return decodeVerdict(await this.read("check", address(this.address), symbol(service), i128(normalizeAmount(amount))));
  }

  async policy(): Promise<Policy | null> {
    const value = await this.read("policy", address(this.address));
    return value == null ? null : decodePolicy(value);
  }

  async usage(): Promise<Usage> {
    return decodeUsage(await this.read("usage", address(this.address)));
  }

  async reconcile(key: string): Promise<"paid" | "unpaid"> {
    validateKey(key);
    const used = await this.read("is_key_used", address(this.address), keyScVal(key));
    return used ? "paid" : "unpaid";
  }

  async pay(input: {
    service: string;
    amount: string | bigint;
    memo?: string;
    key?: string;
  }): Promise<PayOutcome> {
    const amount = normalizeAmount(input.amount);
    const key = input.key ?? randomBytes(32).toString("hex");
    validateKey(key);

    const verdict = await this.check(input.service, amount);
    if (verdict.rule !== Rule.Ok) {
      return { status: "refused", key, rule: verdict.rule, reason: ruleReason(verdict.rule), overBy: verdict.overBy };
    }

    const transactionAccount = await retryRead(() => this.server.getAccount(this.address));
    const transaction = new TransactionBuilder(transactionAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "pay",
          address(this.address),
          symbol(input.service),
          i128(amount),
          string(input.memo ?? ""),
          keyScVal(key),
        ),
      )
      .setTimeout(120)
      .build();

    let prepared: Awaited<ReturnType<rpc.Server["prepareTransaction"]>>;
    try {
      prepared = await retryRead(() => this.server.prepareTransaction(transaction));
    } catch (error) {
      const rule = contractErrorCode(error);
      if (rule !== null) {
        return { status: "refused", key, rule, reason: ruleReason(rule), overBy: verdict.overBy };
      }
      throw error;
    }

    prepared.sign(this.keypair);
    const sent = await this.server.sendTransaction(prepared);
    if (sent.status === "ERROR") {
      throw new Error(`The network rejected the transaction${sent.errorResult ? ` (${sent.errorResult.toXDR("base64")})` : ""}.`);
    }

    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await retryRead(() => this.server.getTransaction(sent.hash));
      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return {
          status: "paid",
          key,
          txHash: sent.hash,
          explorerUrl: `${TESTNET.explorer}/tx/${sent.hash}`,
          receipt: decodeReceipt(result.returnValue ? scValToNative(result.returnValue) : undefined),
        };
      }
      if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction ${sent.hash} failed on chain`);
      }
      await wait(1_000);
    }

    return { status: "pending", key, txHash: sent.hash };
  }
}
