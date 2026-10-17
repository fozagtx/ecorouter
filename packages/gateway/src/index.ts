import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import type { RouteConfig } from "@x402/core/server";
import { paymentMiddlewareFromHTTPServer } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import express, { type Express, type Request, type Response } from "express";
import { Pool } from "pg";

export interface Listing {
  id: string;
  name: string;
  task: string;
  seller: string;
  kind: "api" | "mcp";
  payee: string;
  url: string;
  price: bigint;
  suspended: boolean;
}

export interface Upstream {
  id: string;
  kind: "api" | "mcp";
  url: string;
  auth_header: string | null;
  seller: string;
}

export interface ListingSource {
  list(): Promise<Listing[]>;
  get(id: string): Promise<Listing | null>;
}

export interface UpstreamStore {
  initialize(): Promise<void>;
  get(id: string): Promise<Upstream | null>;
  listConnected(ids: string[]): Promise<Set<string>>;
  put(upstream: Upstream): Promise<void>;
}

export class ChainRegistry implements ListingSource {
  private readonly rpc: rpc.Server;
  private readonly registryId: string;
  private readonly networkPassphrase: string;
  private readonly source: Account;
  private cached?: { expires: number; listings: Listing[] };
  private inflight?: Promise<Listing[]>;

  constructor(registryId: string, rpcUrl: string, networkPassphrase = Networks.TESTNET) {
    this.registryId = registryId;
    this.rpc = new rpc.Server(rpcUrl);
    this.networkPassphrase = networkPassphrase;
    this.source = new Account(Keypair.random().publicKey(), "0");
  }

  private async read(method: string, ...args: xdr.ScVal[]): Promise<unknown> {
    const tx = new TransactionBuilder(this.source, { fee: "100", networkPassphrase: this.networkPassphrase })
      .addOperation(new Contract(this.registryId).call(method, ...args))
      .setTimeout(30)
      .build();
    const simulation = await this.rpc.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
      throw new Error(`Registry ${method} simulation failed: ${JSON.stringify(simulation)}`);
    }
    return scValToNative(simulation.result.retval);
  }

  async list(): Promise<Listing[]> {
    if (this.cached && this.cached.expires > Date.now()) return this.cached.listings;
    if (!this.inflight) {
      this.inflight = this.read("list").then((value) => {
        const listings = (value as unknown[]).map(decodeListing);
        this.cached = { expires: Date.now() + 30_000, listings };
        return listings;
      }).finally(() => { this.inflight = undefined; });
    }
    return this.inflight;
  }

  async get(id: string): Promise<Listing | null> {
    return (await this.list()).find((listing) => listing.id === id) ?? null;
  }
}

function decodeListing(value: unknown): Listing {
  const item = value as Record<string, unknown>;
  const id = String(item.id);
  const kind = String(item.kind);
  if (kind !== "api" && kind !== "mcp") throw new Error(`Invalid on-chain listing kind: ${kind}`);
  return {
    id,
    name: String(item.name),
    task: String(item.task),
    seller: String(item.seller),
    kind,
    payee: String(item.payee),
    url: String(item.url),
    price: BigInt(String(item.price)),
    suspended: Boolean(item.suspended),
  };
}

export class PostgresUpstreams implements UpstreamStore {
  constructor(private readonly pool: Pool) {}

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS upstreams (
        id text PRIMARY KEY,
        kind text NOT NULL CHECK (kind IN ('api', 'mcp')),
        url text NOT NULL,
        auth_header text NULL,
        seller text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async get(id: string): Promise<Upstream | null> {
    const result = await this.pool.query<Upstream>(
      "SELECT id, kind, url, auth_header, seller FROM upstreams WHERE id = $1",
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listConnected(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const result = await this.pool.query<{ id: string }>("SELECT id FROM upstreams WHERE id = ANY($1::text[])", [ids]);
    return new Set(result.rows.map((row) => row.id));
  }

  async put(upstream: Upstream): Promise<void> {
    await this.pool.query(
      `INSERT INTO upstreams (id, kind, url, auth_header, seller, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, url = EXCLUDED.url,
         auth_header = EXCLUDED.auth_header, seller = EXCLUDED.seller, updated_at = now()`,
      [upstream.id, upstream.kind, upstream.url, upstream.auth_header, upstream.seller],
    );
  }
}

export function sep53Message(message: string): Buffer {
  return createHash("sha256").update(`Stellar Signed Message:\n${message}`, "utf8").digest();
}

export function verifySellerSignature(
  address: string,
  signatureBase64: string,
  message: string,
): boolean {
  try {
    StrKey.decodeEd25519PublicKey(address);
    const signature = Buffer.from(signatureBase64, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== signatureBase64) return false;
    return Keypair.fromPublicKey(address).verify(sep53Message(message), signature);
  } catch {
    return false;
  }
}

export async function validateUpstreamUrl(
  raw: string,
  production: boolean,
  resolver: (host: string) => Promise<string[]> = async (host) =>
    (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address),
): Promise<URL> {
  const url = new URL(raw);
  if (url.username || url.password || url.hash || !["https:", "http:"].includes(url.protocol)) {
    throw new Error("Upstream URL must use HTTPS and contain no credentials");
  }
  const loopbackName = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && (production || !loopbackName)) {
    throw new Error("Upstream URL must use HTTPS");
  }
  if (production) {
    const host = url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
    const addresses = isIP(host) ? [host] : await resolver(host);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new Error("Upstream URL resolves to a private or link-local address");
    }
  }
  return url;
}

function isPrivateAddress(value: string): boolean {
  try {
    const normalized = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
    return isIP(normalized) !== 0 && ipaddr.parse(normalized).range() !== "unicast";
  } catch {
    return true;
  }
}

export function createGateway(options: {
  listings: ListingSource;
  upstreams: UpstreamStore;
  facilitatorUrl: string;
  localFacilitatorUrl?: string;
  usdc: string;
  publicUrl: string;
  nodeEnv?: string;
  nebiusApiKey?: string;
  fetcher?: typeof fetch;
}): Express {
  const app = express();
  const fetcher = options.fetcher ?? fetch;
  app.use(express.raw({ type: "*/*", limit: "2mb" }));

  class ReportingFacilitator extends HTTPFacilitatorClient {
    private readonly fallback?: HTTPFacilitatorClient;

    constructor() {
      super({ url: options.facilitatorUrl });
      this.fallback = options.localFacilitatorUrl
        ? new HTTPFacilitatorClient({ url: options.localFacilitatorUrl })
        : undefined;
    }

    override async verify(...args: Parameters<HTTPFacilitatorClient["verify"]>) {
      let result = await super.verify(...args);
      console.info(`facilitator verify response: ${JSON.stringify(result)}`);
      if (!result.isValid && this.fallback) {
        console.info("x402.org refused verification; trying the local facilitator");
        result = await this.fallback.verify(...args);
        console.info(`local facilitator verify response: ${JSON.stringify(result)}`);
      }
      return result;
    }

    override async settle(...args: Parameters<HTTPFacilitatorClient["settle"]>) {
      let result = await super.settle(...args);
      console.info(`facilitator settle response: ${JSON.stringify(result)}`);
      if (!result.success && this.fallback) {
        console.info("x402.org refused settlement; trying the local facilitator");
        result = await this.fallback.settle(...args);
        console.info(`local facilitator settle response: ${JSON.stringify(result)}`);
      }
      return result;
    }
  }

  const resourceServer = new x402ResourceServer(new ReportingFacilitator())
    .register("stellar:testnet", new ExactStellarScheme());
  const routeConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      network: "stellar:testnet",
      payTo: async (context) => {
        const listing = await options.listings.get(listingId(context.path));
        if (!listing) throw new Error("Unknown listing");
        return listing.payee;
      },
      price: async (context) => {
        const listing = await options.listings.get(listingId(context.path));
        if (!listing) throw new Error("Unknown listing");
        return `$${formatUsdc(listing.price)}`;
      },
      extra: { paymentFlow: "upfront" },
    },
    description: "Call a registered EcoRouter agent",
    resource: `${options.publicUrl}/a/{id}`,
  };
  const routes = Object.fromEntries(
    ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => [`${method} /a/*`, routeConfig]),
  );
  const httpServer = new x402HTTPResourceServer(resourceServer, routes);
  let resourceServerInitialization: Promise<void> | undefined;
  httpServer.onProtectedRequest(async (context) => {
    const listing = await options.listings.get(listingId(context.path));
    if (listing?.kind === "mcp" && isMcpFreeMethod(parseBody(context.adapter.getBody?.()))) {
      return { grantAccess: true };
    }
    return undefined;
  });

  type ProxyContext = { id: string; listing: Listing; upstream: Upstream; body: unknown; needsPayment: boolean };
  app.use(async (req, res, next) => {
    if (!/^\/a\/[^/]+(?:\/.*)?$/.test(req.path)) return next();
    try {
      const id = listingId(req.path);
      const listing = await options.listings.get(id);
      if (!listing || listing.suspended) return res.status(404).json({ error: "Unknown or suspended listing" });
      const upstream = await options.upstreams.get(id);
      if (!upstream) return res.status(503).json({ error: "Listing has no connected upstream" });
      if (upstream.kind !== listing.kind || upstream.seller !== listing.seller) {
        return res.status(503).json({ error: "Listing upstream is unavailable" });
      }
      const body = parseBody(req.body);
      if (upstream.url === "builtin:nebius") {
        const input = body as { prompt?: unknown; max_tokens?: unknown };
        const tokens = input?.max_tokens === undefined ? 64 : Number(input.max_tokens);
        if (req.method !== "POST" || typeof input?.prompt !== "string" || !input.prompt.trim() ||
            !Number.isInteger(tokens) || tokens < 1 || tokens > 256) {
          return res.status(400).json({ error: "Expected POST {prompt, max_tokens<=256}" });
        }
      } else {
        await validateUpstreamUrl(upstream.url, options.nodeEnv === "production");
      }
      const needsPayment = listing.kind !== "mcp" || isMcpPaidMethod(body);
      if (listing.kind === "mcp" && !needsPayment && !isMcpFreeMethod(body)) {
        return res.status(400).json({ error: "Unsupported MCP method" });
      }
      if (needsPayment) {
        resourceServerInitialization ??= httpServer.initialize();
        await resourceServerInitialization;
      }
      res.locals.gatewayProxy = { id, listing, upstream, body, needsPayment } satisfies ProxyContext;
      return next();
    } catch (error) {
      return next(error);
    }
  });

  app.use(paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, false));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/listings", async (_req, res, next) => {
    try {
      const listings = await options.listings.list();
      const connected = await options.upstreams.listConnected(listings.map((item) => item.id));
      res.json(listings.map((item) => ({
        id: item.id, name: item.name, task: item.task, kind: item.kind, payee: item.payee,
        url: item.url, price: item.price.toString(), suspended: item.suspended,
        connected: connected.has(item.id),
      })));
    } catch (error) { next(error); }
  });
  app.get("/.well-known/agent-tools.json", async (_req, res, next) => {
    try {
      const listings = await options.listings.list();
      res.json({
        network: "stellar:testnet",
        asset: options.usdc,
        tools: listings.filter((item) => !item.suspended).map((item) => ({
          id: item.id, name: item.name, task: item.task, kind: item.kind,
          price: formatUsdc(item.price), amount: item.price.toString(),
          network: "stellar:testnet", asset: options.usdc, payTo: item.payee,
          url: `${options.publicUrl}/a/${item.id}`,
        })),
      });
    } catch (error) { next(error); }
  });

  app.post("/listings/:id/upstream", async (req, res) => {
    const id = req.params.id;
    const listing = await options.listings.get(id);
    if (!listing || listing.suspended) return res.status(404).json({ error: "Unknown listing" });
    const body = parseBody(req.body) as { url?: unknown; kind?: unknown; authHeader?: unknown };
    const address = req.get("X-Stellar-Address") ?? "";
    const signature = req.get("X-Stellar-Signature") ?? "";
    const timestamp = Number(req.get("X-Timestamp"));
    if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
      return res.status(401).json({ error: "Invalid signature timestamp" });
    }
    const bodyHash = createHash("sha256").update(Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(body))).digest("hex");
    const message = `ecorouter:upstream:${id}:${bodyHash}:${timestamp}`;
    if (address !== listing.seller || !verifySellerSignature(address, signature, message)) {
      return res.status(401).json({ error: "Invalid seller signature" });
    }
    if (body.kind !== listing.kind || typeof body.url !== "string" ||
        (body.authHeader != null && (typeof body.authHeader !== "string" ||
          body.authHeader.length > 4096 || /[\r\n]/.test(body.authHeader)))) {
      return res.status(400).json({ error: "Upstream kind must match the on-chain listing" });
    }
    try {
      const url = await validateUpstreamUrl(body.url, options.nodeEnv === "production");
      await options.upstreams.put({
        id, kind: listing.kind, url: url.toString().replace(/\/$/, ""),
        auth_header: (body.authHeader as string | null) ?? null, seller: listing.seller,
      });
      return res.status(204).end();
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid URL" });
    }
  });

  const proxy = async (_req: Request, res: Response, next: (error?: unknown) => void) => {
    try {
      const { id, upstream, body } = res.locals.gatewayProxy as ProxyContext;
      const result = upstream.url === "builtin:nebius"
        ? await callNebius(fetcher, options.nebiusApiKey, _req, body)
        : await fetchUpstream(fetcher, _req, upstream, id);
      if (!result.ok) {
        return res.status(502).json({ error: "Upstream failed after settlement" });
      }
      if (result.headers.get("content-type")) res.set("content-type", result.headers.get("content-type")!);
      const session = result.headers.get("mcp-session-id");
      if (session) res.set("Mcp-Session-Id", session);
      res.status(result.status);
      return res.send(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      return next(error);
    }
  };
  app.all(/^\/a\/[^/]+(?:\/.*)?$/, proxy);
  app.use((error: unknown, _req: Request, res: Response, _next: unknown) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "Gateway error" });
  });
  return app;
}

function listingId(path: string): string {
  return decodeURIComponent(path.split("/")[2] ?? "");
}

function parseBody(body: unknown): unknown {
  if (!Buffer.isBuffer(body)) return body;
  try { return JSON.parse(body.toString("utf8")); } catch { return undefined; }
}

export function isMcpFreeMethod(body: unknown): boolean {
  const method = (body as { method?: unknown } | undefined)?.method;
  return typeof method === "string" &&
    (method === "initialize" || method.startsWith("notifications/") ||
      ["tools/list", "resources/list", "prompts/list"].includes(method));
}

export function isMcpPaidMethod(body: unknown): boolean {
  return (body as { method?: unknown } | undefined)?.method === "tools/call";
}

function formatUsdc(stroops: bigint): string {
  const whole = stroops / 10_000_000n;
  const fraction = (stroops % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

async function callNebius(fetcher: typeof fetch, apiKey: string | undefined, req: Request, body: unknown): Promise<globalThis.Response> {
  if (!apiKey) throw new Error("Nebius upstream is not configured");
  if (req.method !== "POST") return new globalThis.Response("Method not allowed", { status: 405 });
  const input = body as { prompt?: unknown; max_tokens?: unknown };
  if (typeof input?.prompt !== "string" || !input.prompt.trim()) return new globalThis.Response("prompt is required", { status: 400 });
  const maxTokens = input.max_tokens === undefined ? 64 : Number(input.max_tokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 256) {
    return new globalThis.Response("max_tokens must be an integer from 1 to 256", { status: 400 });
  }
  const response = await fetcher("https://api.tokenfactory.nebius.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/gpt-oss-120b", messages: [{ role: "user", content: input.prompt }], max_tokens: maxTokens }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) return new globalThis.Response(await response.text(), { status: 502 });
  const result = await response.json() as {
    model: string; choices?: Array<{ message?: { content?: string } }>; usage?: unknown;
  };
  return globalThis.Response.json({
    model: result.model,
    output: result.choices?.[0]?.message?.content ?? "",
    usage: result.usage,
  });
}

async function fetchUpstream(
  fetcher: typeof fetch, req: Request, upstream: Upstream, id: string,
): Promise<globalThis.Response> {
  const base = new URL(upstream.url);
  const path = req.path.split("/").slice(3).join("/");
  base.pathname = `${base.pathname.replace(/\/$/, "")}${path ? `/${path}` : ""}`;
  base.search = new URL(req.originalUrl, "http://gateway.local").search;
  const headers = new Headers();
  for (const name of ["accept", "content-type", "mcp-session-id", "mcp-protocol-version"]) {
    const value = req.get(name);
    if (value) headers.set(name, value);
  }
  if (upstream.auth_header) headers.set("Authorization", upstream.auth_header);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined :
    Buffer.isBuffer(req.body) ? req.body : req.body === undefined ? undefined : JSON.stringify(req.body);
  return fetcher(base, {
    method: req.method, headers, body: body as BodyInit | undefined,
    signal: AbortSignal.timeout(60_000), redirect: "manual",
  });
}
