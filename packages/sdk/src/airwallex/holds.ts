import { randomUUID } from "node:crypto";
import { toUsd, usd, type Micros } from "../money.js";
import type { AirwallexClient } from "./client.js";

// Customer card holds on Airwallex Payments (Kit 12): a pre-authorization per job,
// raised when the customer approves more, captured once for what the job spent.
// Verified against airwallex.com/docs/api/payments/payment_intents (2026-10).

export interface PaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  captured_amount?: number;
  merchant_order_id?: string;
  next_action?: unknown;
  latest_payment_attempt?: { status?: string; amount?: number; captured_amount?: number; failure_code?: string };
}

export interface Hold {
  intentId: string;
  jobId: string;
  /** Total currently authorized, in micro-dollars. */
  held: Micros;
  status: "held" | "captured" | "cancelled";
  captured: Micros;
}

/** Card details for sandbox holds. Use the documented test card; never real card data. */
export interface TestCard {
  number: string;
  expiryMonth: string;
  expiryYear: string;
  cvc: string;
  name: string;
}

/** Sandbox Visa test card from the Airwallex docs and the Kit 12 guide. */
export const SANDBOX_TEST_CARD: TestCard = {
  number: "4035501000000008",
  expiryMonth: "12",
  expiryYear: "2030",
  cvc: "123",
  name: "EcoRouter Demo",
};

/** The operations a job needs from a hold provider. Airwallex in production, a simulator in tests. */
export interface HoldRail {
  place(jobId: string, amount: Micros): Promise<Hold>;
  increase(hold: Hold, newTotal: Micros): Promise<Hold>;
  capture(hold: Hold, amount: Micros): Promise<Hold>;
  cancel(hold: Hold, reason: string): Promise<Hold>;
}

/** Amounts are major units with 2 decimals for USD. Holds round up so they always cover the budget. */
function toMajorUp(micros: Micros): number {
  return Math.ceil(toUsd(micros) * 100 - 1e-9) / 100;
}
function toMajorDown(micros: Micros): number {
  return Math.floor(toUsd(micros) * 100 + 1e-9) / 100;
}

export class AirwallexHolds implements HoldRail {
  constructor(
    private readonly client: AirwallexClient,
    private readonly card: TestCard = SANDBOX_TEST_CARD,
    private readonly currency = "USD",
  ) {}

  /** Create and confirm a pre-authorization. Status must reach REQUIRES_CAPTURE. */
  async place(jobId: string, amount: Micros): Promise<Hold> {
    const created = await this.client.request<PaymentIntent>("POST", "/api/v1/pa/payment_intents/create", undefined, {
      request_id: randomUUID(),
      amount: toMajorUp(amount),
      currency: this.currency,
      merchant_order_id: `ecorouter-${jobId}`.slice(0, 64),
      metadata: { ecorouter_job: jobId },
    });
    const confirmed = await this.client.request<PaymentIntent>("POST", `/api/v1/pa/payment_intents/${created.id}/confirm`, undefined, {
      request_id: randomUUID(),
      payment_method: {
        type: "card",
        card: {
          number: this.card.number,
          expiry_month: this.card.expiryMonth,
          expiry_year: this.card.expiryYear,
          cvc: this.card.cvc,
          name: this.card.name,
        },
      },
      payment_method_options: { card: { authorization_type: "pre_auth", auto_capture: false } },
    });
    if (confirmed.status !== "REQUIRES_CAPTURE") {
      throw new Error(`hold for job ${jobId} not authorized: intent ${confirmed.id} is ${confirmed.status}`);
    }
    return { intentId: confirmed.id, jobId, held: usd(confirmed.amount), status: "held", captured: 0 };
  }

  /** Raise the hold. Airwallex takes the new total, not the difference. */
  async increase(hold: Hold, newTotal: Micros): Promise<Hold> {
    if (hold.status !== "held") throw new Error(`hold ${hold.intentId} is ${hold.status}`);
    if (newTotal <= hold.held) throw new RangeError("a raised hold must be larger than the current one");
    const intent = await this.client.request<PaymentIntent>("POST", `/api/v1/pa/payment_intents/${hold.intentId}/increment_authorization`, undefined, {
      request_id: randomUUID(),
      amount: toMajorUp(newTotal),
    });
    return { ...hold, held: usd(intent.amount) };
  }

  /** Capture once, never more than the hold. */
  async capture(hold: Hold, amount: Micros): Promise<Hold> {
    if (hold.status !== "held") throw new Error(`hold ${hold.intentId} is ${hold.status}`);
    if (amount > hold.held) throw new RangeError(`capture ${amount} is above the hold ${hold.held}`);
    const major = toMajorDown(amount);
    if (major <= 0) return this.cancel(hold, "job spent less than one cent");
    const intent = await this.client.request<PaymentIntent>("POST", `/api/v1/pa/payment_intents/${hold.intentId}/capture`, undefined, {
      request_id: randomUUID(),
      amount: major,
    });
    return { ...hold, status: "captured", captured: usd(intent.captured_amount ?? major) };
  }

  /** Release the whole hold, e.g. for a job that failed. */
  async cancel(hold: Hold, reason: string): Promise<Hold> {
    if (hold.status !== "held") return hold;
    await this.client.request<PaymentIntent>("POST", `/api/v1/pa/payment_intents/${hold.intentId}/cancel`, undefined, {
      request_id: randomUUID(),
      cancellation_reason: reason.slice(0, 120),
    });
    return { ...hold, status: "cancelled" };
  }
}
