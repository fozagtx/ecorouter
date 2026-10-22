// Minimal Airwallex API client: auth, balances, issuing cards, transactions, FX.
// Verified against airwallex.com/docs (API reference, 2026-10). Amounts are decimal major units.

export const AIRWALLEX_HOSTS = {
  sandbox: "https://api.sandbox.airwallex.com",
  production: "https://api.airwallex.com",
} as const;

export interface AirwallexConfig {
  clientId: string;
  apiKey: string;
  env?: keyof typeof AIRWALLEX_HOSTS;
  /** Account id for keys scoped to several accounts (x-login-as). */
  loginAs?: string;
  fetch?: typeof fetch;
  /** Retries on HTTP 429, with exponential backoff and jitter. Default 3. */
  maxRetries?: number;
}

export class AirwallexError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId?: string,
  ) {
    super(`Airwallex ${status} ${code}: ${message}`);
    this.name = "AirwallexError";
  }
}

export interface Balance {
  account_type?: string;
  currency: string;
  available_amount: number;
  pending_amount: number;
  reserved_amount: number;
  total_amount: number;
}

export type LimitInterval = "PER_TRANSACTION" | "DAILY" | "WEEKLY" | "MONTHLY" | "ALL_TIME";

export interface TransactionLimits {
  currency?: string;
  limits: Array<{ amount: number; interval: LimitInterval }>;
  cash_withdrawal_limits?: Array<{ amount: number; interval: LimitInterval }>;
}

export interface AuthorizationControls {
  allowed_transaction_count: "SINGLE" | "MULTIPLE";
  transaction_limits: TransactionLimits;
  allowed_merchant_categories?: string[];
  allowed_currencies?: string[];
}

export interface CreateCardInput {
  request_id: string;
  cardholder_id: string;
  created_by: string;
  form_factor: "VIRTUAL" | "PHYSICAL";
  is_personalized: boolean;
  program: { purpose: "COMMERCIAL" | "CONSUMER"; type?: "PREPAID" | "DEBIT" | "CREDIT" | "DEFERRED_DEBIT" };
  authorization_controls: AuthorizationControls;
  nick_name?: string;
  metadata?: Record<string, string>;
}

export interface Card {
  card_id: string;
  card_status: string;
  cardholder_id: string;
  card_number?: string;
  nick_name?: string;
  authorization_controls?: AuthorizationControls;
  metadata?: Record<string, string>;
}

export interface CardLimits {
  currency: string;
  limits: Array<{ amount: number; interval: LimitInterval; remaining: number }>;
}

export interface IssuingTransaction {
  transaction_id: string;
  card_id: string;
  transaction_amount: number;
  transaction_currency: string;
  billing_amount: number;
  billing_currency: string;
  status: "APPROVED" | "CLEARED" | "EXPIRED" | "FAILED" | "PENDING" | "REVERSED";
  transaction_type: "AUTHORIZATION" | "CLEARING" | "REFUND" | "REVERSAL" | "ORIGINAL_CREDIT";
  transaction_date?: string;
  failure_reason?: string;
  merchant?: { name?: string; category_code?: string };
}

export interface FxQuote {
  buyCurrency: string;
  sellCurrency: string;
  buyAmount: number;
  sellAmount: number;
  /** sell units paid per one buy unit, from the CLIENT rate level. */
  sellPerBuy: number;
}

export class AirwallexClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AirwallexConfig) {
    this.host = AIRWALLEX_HOSTS[config.env ?? "sandbox"];
    this.fetchImpl = config.fetch ?? fetch;
  }

  /** GET /api/v1/balances/current */
  balances(accountType?: "cash" | "yield" | "credit"): Promise<Balance[]> {
    return this.request("GET", "/api/v1/balances/current", accountType ? { account_type: accountType } : undefined);
  }

  /** POST /api/v1/issuing/cards/create. The cardholder must be in READY status. */
  createCard(input: CreateCardInput): Promise<Card> {
    return this.request("POST", "/api/v1/issuing/cards/create", undefined, input);
  }

  /** POST /api/v1/issuing/cards/{id}/update (partial update). */
  updateCard(cardId: string, patch: { authorization_controls?: Partial<AuthorizationControls>; card_status?: string; nick_name?: string }): Promise<Card> {
    return this.request("POST", `/api/v1/issuing/cards/${encodeURIComponent(cardId)}/update`, undefined, patch);
  }

  /** GET /api/v1/issuing/cards/{id} */
  getCard(cardId: string): Promise<Card> {
    return this.request("GET", `/api/v1/issuing/cards/${encodeURIComponent(cardId)}`);
  }

  /** GET /api/v1/issuing/cards/{id}/limits: configured limits with what remains. */
  cardLimits(cardId: string): Promise<CardLimits> {
    return this.request("GET", `/api/v1/issuing/cards/${encodeURIComponent(cardId)}/limits`);
  }

  /** GET /api/v1/issuing/transactions (Airwallex marks this list as legacy; still documented). */
  transactions(query: { card_id?: string; from_created_at?: string; to_created_at?: string; page_num?: number; page_size?: number } = {}): Promise<{ has_more: boolean; items: IssuingTransaction[] }> {
    return this.request("GET", "/api/v1/issuing/transactions", query);
  }

  /**
   * GET /api/v1/fx/rates/current. Reads the CLIENT level of rate_details, whose amounts are
   * unambiguous, instead of the top-level `rate`, whose direction follows market convention.
   */
  async fxQuote(buyCurrency: string, sellCurrency: string, buyAmount: number): Promise<FxQuote> {
    const body = await this.request<{
      rate_details?: Array<{ level: string; buy_amount: number; sell_amount: number }>;
    }>("GET", "/api/v1/fx/rates/current", { buy_currency: buyCurrency, sell_currency: sellCurrency, buy_amount: buyAmount });
    const client = body.rate_details?.find((d) => d.level === "CLIENT") ?? body.rate_details?.[0];
    if (!client || client.buy_amount <= 0) throw new AirwallexError(200, "no_rate", `no client rate for ${buyCurrency}/${sellCurrency}`);
    return {
      buyCurrency,
      sellCurrency,
      buyAmount: client.buy_amount,
      sellAmount: client.sell_amount,
      sellPerBuy: client.sell_amount / client.buy_amount,
    };
  }

  /** Bearer token, reused until a minute before it expires (tokens last 30 minutes). */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const headers: Record<string, string> = { "x-client-id": this.config.clientId, "x-api-key": this.config.apiKey };
    if (this.config.loginAs) headers["x-login-as"] = this.config.loginAs;
    const res = await this.fetchImpl(`${this.host}/api/v1/authentication/login`, { method: "POST", headers });
    const body = (await res.json().catch(() => ({}))) as { token?: string; expires_at?: string; code?: string; message?: string };
    if (!res.ok || !body.token) throw new AirwallexError(res.status, body.code ?? "login_failed", body.message ?? "authentication failed");
    const expiresAt = body.expires_at ? Date.parse(body.expires_at.replace(/\+0000$/, "Z")) : NaN;
    this.token = { value: body.token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 25 * 60_000 };
    return this.token.value;
  }

  private async request<T>(method: "GET" | "POST", path: string, query?: Record<string, string | number | undefined>, body?: unknown): Promise<T> {
    const url = new URL(path, this.host);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const maxRetries = this.config.maxRetries ?? 3;

    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) this.token = null;
      if (res.status === 429 && attempt < maxRetries) {
        await sleep(2 ** attempt * 250 + Math.random() * 250);
        continue;
      }
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : undefined;
      if (!res.ok) {
        const e = (parsed ?? {}) as { code?: string; message?: string; trace_id?: string };
        throw new AirwallexError(res.status, e.code ?? "error", e.message ?? text, e.trace_id);
      }
      return parsed as T;
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
