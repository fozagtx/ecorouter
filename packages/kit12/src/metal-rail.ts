import { decodePaymentRequiredHeader } from "@x402/core/http";
import {
  ClearingRefusal,
  USDZ,
  createClearingClient,
  createMetalPaymentClient,
  depositToClearing,
  registerClearingClient,
  withdrawFromClearing,
} from "@metalntwx/metal-pay";
import { openClearingWallet } from "@metalntwx/metal-pay/node";
import { privateKeyToAccount } from "viem/accounts";
import type { Micros } from "ecorouter";
import type { StepRequest } from "./catalog.js";
import { InsufficientDepositError, PaidStepFailedError, PriceMovedError, type Offer, type PaymentRail, type StepResult } from "./rails.js";
import { baseToMicros, microsToBase } from "./units.js";

const NETWORK = "eip155:63825" as const;
const CHAIN_ID = 63825;
const FACILITATOR = "https://x402-testnet.metalntwx.com/x402/facilitator";

export interface MetalRailConfig {
  /** Base URL of the provider server, e.g. http://127.0.0.1:4021 */
  providersUrl: string;
  /** Your Metal testnet RPC endpoint (from console-testnet.metalntwx.com). */
  rpcUrl: string;
  /** Private key holding the USDZ float. It pays deposits and gas. */
  floatPrivateKey: `0x${string}`;
  /** Directory for per-job clearing wallets. One process per directory. */
  walletRoot: string;
}

type Wallet = Awaited<ReturnType<typeof openClearingWallet>>;

interface JobClient {
  wallet: Wallet;
  fetchWithPayment: typeof fetch;
  /** Set per call: the most this step may pay, and what was offered when paying. */
  limit: bigint;
  lastOffer: bigint | null;
}

/**
 * Pays our x402 providers per step through Metal clearing.
 * Each job gets its own clearing wallet and deposit, because one clearing account pays one request at a time.
 */
export class MetalRail implements PaymentRail {
  readonly name = "metal-testnet";
  private readonly jobs = new Map<string, JobClient>();
  private readonly account;
  private clearing: { settlement: `0x${string}`; serviceUrl: string } | null = null;

  constructor(private readonly config: MetalRailConfig) {
    this.account = privateKeyToAccount(config.floatPrivateKey);
  }

  /** Settlement contract and clearing service come from the facilitator, not hardcoded: deployments change. */
  private async deployment() {
    if (this.clearing) return this.clearing;
    const res = await fetch(`${FACILITATOR}/supported`);
    const body = (await res.json()) as { kinds: Array<{ scheme: string; network: string; extra?: { settlement?: string; serviceUrl?: string } }> };
    const kind = body.kinds.find((k) => k.scheme === "bajillion" && k.network === NETWORK);
    if (!kind?.extra?.settlement || !kind.extra.serviceUrl) throw new Error("Metal facilitator lists no clearing deployment");
    this.clearing = { settlement: kind.extra.settlement as `0x${string}`, serviceUrl: kind.extra.serviceUrl };
    return this.clearing;
  }

  async offer(providerId: string, req: StepRequest): Promise<Offer> {
    const res = await fetch(`${this.config.providersUrl}/p/${providerId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (res.status !== 402) throw new Error(`${providerId} answered ${res.status} instead of a 402 offer`);
    const header = res.headers.get("PAYMENT-REQUIRED");
    if (!header) throw new Error(`${providerId} sent a 402 without an offer`);
    const required = decodePaymentRequiredHeader(header);
    const clearing = required.accepts.find((a) => a.scheme === "bajillion");
    if (!clearing) throw new Error(`${providerId} does not offer clearing`);
    return { providerId, amount: baseToMicros(clearing.amount) };
  }

  async openJob(jobId: string): Promise<void> {
    const { settlement, serviceUrl } = await this.deployment();
    const wallet = await openClearingWallet(`${this.config.walletRoot}/${jobId}`);
    const job: JobClient = { wallet, fetchWithPayment: fetch, limit: 0n, lastOffer: null };
    const { client, fetchWithPayment } = createMetalPaymentClient({ account: this.account, network: "testnet" });
    registerClearingClient(
      client,
      NETWORK,
      createClearingClient({
        serviceUrl,
        rpcUrl: this.config.rpcUrl,
        network: NETWORK,
        settlement,
        asset: USDZ.address,
        signer: wallet.signer,
        store: wallet.store,
        maxAmount: microsToBase(1_000_000), // hard ceiling of $1 per step, below every job's own limit check
      }),
    );
    // The price is whatever this 402 says. Refuse to sign if it moved above what the step allows.
    client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
      const offered = BigInt(selectedRequirements.amount);
      job.lastOffer = offered;
      if (offered > job.limit) return { abort: true, reason: `offer ${offered} above limit ${job.limit}` };
    });
    job.fetchWithPayment = fetchWithPayment as typeof fetch;
    this.jobs.set(jobId, job);
  }

  private job(jobId: string) {
    const j = this.jobs.get(jobId);
    if (!j) throw new Error(`job ${jobId} not opened`);
    return j;
  }

  async deposit(jobId: string, amount: Micros) {
    const { settlement } = await this.deployment();
    const job = this.job(jobId);
    const { depositTx } = await depositToClearing({
      rpcUrl: this.config.rpcUrl,
      chainId: CHAIN_ID,
      from: this.account,
      settlement,
      asset: USDZ.address,
      account: job.wallet.signer.publicKey,
      amount: microsToBase(amount),
    });
    return { tx: depositTx };
  }

  async run(jobId: string, providerId: string, req: StepRequest, limit: Micros, timeoutMs: number): Promise<StepResult> {
    const job = this.job(jobId);
    job.limit = microsToBase(limit);
    job.lastOffer = null;
    const started = Date.now();
    try {
      const res = await job.fetchWithPayment(`${this.config.providersUrl}/p/${providerId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`${providerId} answered ${res.status}`);
      const text = await res.text();
      return { providerId, text, paid: job.lastOffer === null ? 0 : baseToMicros(job.lastOffer), latencyMs: Date.now() - started };
    } catch (err) {
      const cause = (err as { cause?: unknown }).cause;
      if (cause instanceof ClearingRefusal && cause.reason === "insufficient_deposit") throw new InsufficientDepositError(jobId);
      if (job.lastOffer !== null && job.lastOffer > job.limit) {
        throw new PriceMovedError(providerId, baseToMicros(job.lastOffer), limit);
      }
      // A payment was signed for this request: clearing pays before the answer, so count it as spent.
      if (job.lastOffer !== null) {
        throw new PaidStepFailedError(providerId, baseToMicros(job.lastOffer), err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
  }

  async withdraw(jobId: string) {
    const { settlement, serviceUrl } = await this.deployment();
    const job = this.job(jobId);
    const r = await withdrawFromClearing({
      rpcUrl: this.config.rpcUrl,
      chainId: CHAIN_ID,
      from: this.account,
      settlement,
      signer: job.wallet.signer,
      serviceUrl,
    });
    if (r.status === "waiting") return { status: "waiting" as const, detail: `epoch ${r.epoch}` };
    if (r.status === "empty") return { status: "empty" as const };
    return { status: "sent" as const, detail: r.claimed.map((c) => c.tx).join(",") };
  }

  async close() {
    await Promise.all([...this.jobs.values()].map((j) => j.wallet.close()));
  }
}
