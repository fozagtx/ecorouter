import { createHmac, timingSafeEqual } from "node:crypto";
import type { IssuingTransaction } from "./client.js";

export interface WebhookEvent<T = unknown> {
  id: string;
  name: string;
  account_id?: string;
  created_at: string;
  version?: string;
  data: T;
}

/**
 * Verify an Airwallex webhook: hex(HMAC-SHA256(secret, x-timestamp + raw body)).
 * `x-timestamp` is Unix milliseconds. Pass the raw body string, before any JSON parsing.
 */
export function verifyWebhook(
  rawBody: string,
  headers: { "x-timestamp"?: string | null; "x-signature"?: string | null },
  secret: string,
  opts: { toleranceMs?: number; now?: number } = {},
): WebhookEvent {
  const timestamp = headers["x-timestamp"];
  const signature = headers["x-signature"];
  if (!timestamp || !signature) throw new Error("missing x-timestamp or x-signature");

  const expected = createHmac("sha256", secret).update(timestamp + rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("webhook signature does not match");

  const age = Math.abs((opts.now ?? Date.now()) - Number(timestamp));
  if (!Number.isFinite(age) || age > (opts.toleranceMs ?? 5 * 60_000)) throw new Error("webhook timestamp outside tolerance");

  return JSON.parse(rawBody) as WebhookEvent;
}

export const ISSUING_TRANSACTION_EVENTS = ["issuing.transaction.succeeded", "issuing.transaction.failed"] as const;

/** The transaction inside an issuing event. Docs show it both as `data` and `data.object`, so accept both. */
export function issuingTransaction(event: WebhookEvent): IssuingTransaction | null {
  if (!(ISSUING_TRANSACTION_EVENTS as readonly string[]).includes(event.name)) return null;
  const data = event.data as { object?: IssuingTransaction } & Partial<IssuingTransaction>;
  const tx = (data?.object ?? data) as IssuingTransaction;
  return tx && typeof tx.card_id === "string" ? tx : null;
}
