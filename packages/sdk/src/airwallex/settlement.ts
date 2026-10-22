import { randomUUID } from "node:crypto";
import type { HealthTracker } from "../health.js";
import { toUsd, usd, type Micros } from "../money.js";
import type { PriceSource } from "../prices.js";
import type { AgentPolicy, Period, Price, PriceQuote, Receipt } from "../types.js";
import type { AirwallexClient, AuthorizationControls, Card, IssuingTransaction, LimitInterval } from "./client.js";

const INTERVAL: Record<Period, LimitInterval> = { day: "DAILY", week: "WEEKLY", month: "MONTHLY" };

/**
 * Card controls that mirror an agent's period cap. Providers charge a card per invoice or
 * credit top-up, not per API call, so the per-step ceiling stays in the router and the card
 * holds the period total: no single charge and no period sum can exceed the agent's cap.
 */
export function controlsFor(policy: AgentPolicy, merchantCategories?: string[]): AuthorizationControls {
  const cap = centsUp(toUsd(policy.periodCap));
  return {
    allowed_transaction_count: "MULTIPLE",
    transaction_limits: {
      currency: "USD",
      limits: [
        { amount: cap, interval: "PER_TRANSACTION" },
        { amount: cap, interval: INTERVAL[policy.period] },
      ],
    },
    ...(merchantCategories?.length ? { allowed_merchant_categories: merchantCategories } : {}),
  };
}

export interface CardBinding {
  agentId: string;
  providerId: string;
  cardId: string;
}

/**
 * One Airwallex virtual card per (agent, provider). The card's limits mirror the agent's caps,
 * so the card refuses what the router should never have allowed.
 */
export class ProviderCards {
  private readonly bindings = new Map<string, CardBinding>();

  constructor(
    private readonly client: AirwallexClient,
    private readonly opts: { cardholderId: string; createdBy: string },
  ) {}

  private key(agentId: string, providerId: string) {
    return `${agentId}\u0000${providerId}`;
  }

  /** Load bindings saved from an earlier session instead of creating new cards. */
  restore(bindings: CardBinding[]): void {
    for (const b of bindings) this.bindings.set(this.key(b.agentId, b.providerId), b);
  }

  list(): CardBinding[] {
    return [...this.bindings.values()];
  }

  bindingForCard(cardId: string): CardBinding | undefined {
    return [...this.bindings.values()].find((b) => b.cardId === cardId);
  }

  async ensure(policy: AgentPolicy, providerId: string, merchantCategories?: string[]): Promise<CardBinding> {
    const existing = this.bindings.get(this.key(policy.agentId, providerId));
    if (existing) return existing;
    const card: Card = await this.client.createCard({
      request_id: randomUUID(),
      cardholder_id: this.opts.cardholderId,
      created_by: this.opts.createdBy,
      form_factor: "VIRTUAL",
      is_personalized: false,
      program: { purpose: "COMMERCIAL" },
      authorization_controls: controlsFor(policy, merchantCategories),
      nick_name: `ecorouter ${policy.agentId} ${providerId}`.slice(0, 40),
      metadata: { ecorouter_agent: policy.agentId, ecorouter_provider: providerId },
    });
    const binding = { agentId: policy.agentId, providerId, cardId: card.card_id };
    this.bindings.set(this.key(policy.agentId, providerId), binding);
    return binding;
  }

  /** Push changed caps to every card the agent holds. */
  async syncLimits(policy: AgentPolicy): Promise<void> {
    const controls = controlsFor(policy);
    for (const b of this.bindings.values()) {
      if (b.agentId !== policy.agentId) continue;
      await this.client.updateCard(b.cardId, {
        authorization_controls: { transaction_limits: { ...controls.transaction_limits, cash_withdrawal_limits: [] } },
      });
    }
  }
}

/** Refuse to promise more spend than the funding wallet holds. */
export async function checkFunding(
  client: AirwallexClient,
  policies: AgentPolicy[],
  currency = "USD",
): Promise<{ ok: boolean; available: Micros; committed: Micros }> {
  const balances = await client.balances("cash");
  const available = usd(balances.find((b) => b.currency === currency)?.available_amount ?? 0);
  const committed = policies.filter((p) => !p.paused).reduce((sum, p) => sum + p.periodCap, 0);
  return { ok: committed <= available, available, committed };
}

const DECLINES_THAT_REROUTE = new Set(["LIMIT_EXCEEDED", "INSUFFICIENT_FUNDS", "MERCHANT_CATEGORY_NOT_ALLOWED"]);

export interface ReconcileResult {
  binding: CardBinding | null;
  /** Card spend in micro-dollars (positive), for approved or cleared debits. */
  cardSpend: Micros;
  declined: boolean;
  failureReason?: string;
}

/**
 * Matches card transactions back to the router. A decline at the card marks the provider
 * unhealthy so the next step reroutes, the same way a slow or failing provider does.
 */
export class Reconciler {
  private readonly seen = new Set<string>();
  readonly spendByProvider = new Map<string, Micros>();
  readonly receiptsByProvider = new Map<string, Micros>();

  constructor(
    private readonly cards: ProviderCards,
    private readonly health: HealthTracker,
  ) {}

  /** Feed every router receipt, e.g. from `Router({ onReceipt })`. */
  receipt(r: Receipt): void {
    const k = `${r.agentId}\u0000${r.providerId}`;
    this.receiptsByProvider.set(k, (this.receiptsByProvider.get(k) ?? 0) + r.cost);
  }

  /** Feed each card transaction, from a verified webhook or the transactions list. Duplicates are ignored. */
  transaction(tx: IssuingTransaction): ReconcileResult | null {
    if (this.seen.has(tx.transaction_id)) return null;
    this.seen.add(tx.transaction_id);
    const binding = this.cards.bindingForCard(tx.card_id) ?? null;
    const declined = tx.status === "FAILED";
    if (declined && binding && tx.failure_reason && DECLINES_THAT_REROUTE.has(tx.failure_reason)) {
      this.health.failure(binding.providerId);
    }
    const isDebit = (tx.status === "APPROVED" || tx.status === "CLEARED") && tx.transaction_type !== "REFUND" && tx.transaction_type !== "REVERSAL";
    const cardSpend = isDebit ? usd(Math.abs(tx.billing_amount)) : 0;
    if (binding && cardSpend) {
      const k = `${binding.agentId}\u0000${binding.providerId}`;
      this.spendByProvider.set(k, (this.spendByProvider.get(k) ?? 0) + cardSpend);
    }
    return { binding, cardSpend, declined, failureReason: tx.failure_reason };
  }

  /** Card spend minus router receipts per (agent, provider). Positive means the card paid more than the router recorded. */
  drift(): Array<{ agentId: string; providerId: string; card: Micros; receipts: Micros; drift: Micros }> {
    const keys = new Set([...this.spendByProvider.keys(), ...this.receiptsByProvider.keys()]);
    return [...keys].map((k) => {
      const [agentId, providerId] = k.split("\u0000");
      const card = this.spendByProvider.get(k) ?? 0;
      const receipts = this.receiptsByProvider.get(k) ?? 0;
      return { agentId, providerId, card, receipts, drift: card - receipts };
    });
  }
}

/**
 * Prices quoted in other currencies, converted to USD at the live Airwallex rate
 * before the router compares them to a cap.
 */
export class AirwallexFxPrices implements PriceSource {
  private readonly rates = new Map<string, { at: number; usdPerUnit: number }>();

  constructor(
    private readonly client: AirwallexClient,
    private readonly prices: Record<string, { price: Price; currency: string; source: string }>,
    private readonly ttlMs = 60_000,
  ) {}

  async quote(providerId: string): Promise<PriceQuote | null> {
    const entry = this.prices[providerId];
    if (!entry) return null;
    const factor = entry.currency === "USD" ? 1 : await this.usdPerUnit(entry.currency);
    return { price: scale(entry.price, factor), source: `${entry.source} · FX ${entry.currency}/USD via Airwallex`, fetchedAt: Date.now() };
  }

  private async usdPerUnit(currency: string): Promise<number> {
    const cached = this.rates.get(currency);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.usdPerUnit;
    // Buying the provider's currency with USD: USD paid per one unit.
    const q = await this.client.fxQuote(currency, "USD", 1000);
    this.rates.set(currency, { at: Date.now(), usdPerUnit: q.sellPerBuy });
    return q.sellPerBuy;
  }
}

function scale(price: Price, f: number): Price {
  switch (price.unit) {
    case "token":
      return { unit: "token", inputPerMTok: price.inputPerMTok * f, outputPerMTok: price.outputPerMTok * f };
    case "request":
      return { unit: "request", usd: price.usd * f };
    case "credit":
      return { unit: "credit", usdPerCredit: price.usdPerCredit * f, creditsPerCall: price.creditsPerCall };
  }
}

/** Card limits are in cents and must be above zero. */
function centsUp(n: number): number {
  return Math.max(0.01, Math.ceil(n * 100 - 1e-9) / 100);
}
