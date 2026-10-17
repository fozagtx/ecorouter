/**
 * The assistant turns one sentence into a payment draft. Its only output is
 * the `propose_payment` tool below: a service id from the spender's own list,
 * an amount, a currency and a memo. There is no address field, so an invented
 * recipient cannot even be written down; the registry decides who is paid.
 *
 * Drafting runs locally (keyword matching, no model call). Any model can be
 * plugged in behind the same tool schema without changing what it can do.
 */
import { parseAmount } from "../lib/money";
import type { Service } from "../engine/types";

export interface Draft {
  service: string;
  amount: string;
  currency: "USDC";
  memo: string;
}

export function paymentTool(allowed: string[]) {
  return {
    name: "propose_payment",
    description: "Propose one payment to a service on this spender's approved list. You cannot choose an address.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["service", "amount", "currency", "memo"],
      properties: {
        service: { type: "string", enum: allowed },
        amount: { type: "string", pattern: "^\\d+(\\.\\d{1,7})?$" },
        currency: { type: "string", const: "USDC" },
        memo: { type: "string", maxLength: 64 },
      },
    },
  } as const;
}

export interface Proposal {
  /** What the assistant put in the `service` field (may be invented). */
  service: string | null;
  amount: string | null;
  memo: string;
  /** Why the assistant chose that service, for display. */
  because: string;
}

const STOP = new Set(["pay", "send", "top", "up", "our", "the", "a", "an", "for", "to", "by", "of", "my", "me", "please", "and", "with", "on", "in", "some", "more", "buy", "get", "usd", "usdc", "dollars", "dollar", "credits"]);

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
}

/** Pulls the amount out of a sentence: "$120", "120 usdc", "120.50 dollars". */
export function readAmount(sentence: string): string | null {
  const m =
    /\$\s?(\d[\d,]*(?:\.\d{1,7})?)/.exec(sentence) ??
    /(\d[\d,]*(?:\.\d{1,7})?)\s?(?:usdc|usd|dollars?|bucks)\b/i.exec(sentence) ??
    /\b(?:by|of|for)\s+(\d[\d,]*(?:\.\d{1,7})?)\b/i.exec(sentence);
  return m ? m[1].replace(/,/g, "") : null;
}

/**
 * Picks the service the sentence most plausibly means. It considers the
 * spender's list first, then other registered services. When nothing
 * matches but the sentence names a recipient ("pay Acme Labs $50"), it
 * proposes that name as-is, the way a model might invent one, so the schema
 * layer can be seen refusing it.
 */
export function propose(sentence: string, allowed: string[], registry: Service[]): Proposal {
  const amount = readAmount(sentence);
  const ws = words(sentence).filter((w) => !STOP.has(w) && !/^\d/.test(w));
  const memoMatch = /\bfor\s+(?!\$?\d)(.+)$/i.exec(sentence);
  const memo = (memoMatch ? memoMatch[1] : sentence).trim().replace(/[.!]+$/, "").slice(0, 64);

  const meta = (id: string) => registry.find((s) => s.id === id);
  const score = (id: string): number => {
    const s = meta(id);
    const vocab = new Set([id.toLowerCase(), ...words(s?.name ?? ""), ...words(s?.task ?? "")]);
    return ws.reduce((n, w) => n + (vocab.has(w) ? (w === id ? 3 : 1) : 0), 0);
  };
  const rank = (ids: string[]) => ids.map((id) => ({ id, n: score(id) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);

  const own = rank(allowed);
  if (own.length) {
    const s = meta(own[0].id);
    return { service: own[0].id, amount, memo, because: `Matched “${s?.name ?? own[0].id}” on your approved list.` };
  }
  const other = rank(registry.map((s) => s.id).filter((id) => !allowed.includes(id)));
  if (other.length) {
    return { service: other[0].id, amount, memo, because: `Matched “${meta(other[0].id)?.name}”, which is registered but not on your list.` };
  }
  const named = /\b(?:pay|send|to)\s+([a-z][\w-]*(?:\s+[a-z][\w-]*)?)/i.exec(sentence.replace(/\$\s?\d[\d,.]*/g, ""));
  if (named) {
    const invented = named[1].toLowerCase().replace(/\s+/g, "_");
    return { service: invented, amount, memo, because: `Took “${named[1]}” from the sentence as the service name.` };
  }
  return { service: null, amount, memo, because: "Could not tell which service the sentence means." };
}

export type SchemaResult =
  | { ok: true; draft: Draft; atomic: bigint }
  | { ok: false; reason: string; registeredElsewhere?: boolean };

/** Validates a proposal against the tool schema, the way a strict tool-call parser would. */
export function validate(p: Proposal, allowed: string[], registry: Service[]): SchemaResult {
  if (!p.service) return { ok: false, reason: "No service named. The draft has no service field to send." };
  if (!allowed.includes(p.service)) {
    const registered = registry.some((s) => s.id === p.service);
    return {
      ok: false,
      registeredElsewhere: registered,
      reason: registered
        ? `“${p.service}” is registered, but it is not in this spender's enum of approved services.`
        : `“${p.service}” is not in the enum of approved services. The draft is refused before anything touches the network.`,
    };
  }
  if (!p.amount) return { ok: false, reason: "No amount in the sentence. The schema requires one." };
  const atomic = parseAmount(p.amount);
  if (atomic === null) return { ok: false, reason: `“${p.amount}” is not a valid USDC amount.` };
  return { ok: true, atomic, draft: { service: p.service, amount: p.amount, currency: "USDC", memo: p.memo } };
}

export const EXAMPLES = [
  "Top up our inference credits by $120",
  "Pay $420 for inference, annual prepay",
  "Buy 2 hours of GPU for $90",
  "Pay Acme Labs $50 for consulting",
  "$35 of translation for the launch post",
];
