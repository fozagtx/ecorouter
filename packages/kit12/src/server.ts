import express, { type Request, type Response } from "express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { ClearingServerScheme, METAL_NETWORKS, registerMetalScheme } from "@metalntwx/metal-pay";
import { openClearingWallet } from "@metalntwx/metal-pay/node";
import { CATALOG, DEFAULT_STATE, latencyMs, quote, standInAnswer, type ProviderSpec, type ProviderState, type StepRequest } from "./catalog.js";
import { microsToBase } from "./units.js";

const NETWORK = "eip155:63825" as const;

export interface ProviderServerOptions {
  port: number;
  /** Directory holding one clearing wallet per provider (each provider is paid to its own key). */
  walletRoot: string;
  specs?: ProviderSpec[];
  facilitatorUrl?: string;
}

export interface ProviderServer {
  url: string;
  state: Map<string, ProviderState>;
  close(): Promise<void>;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stepRequest(body: unknown, spec: ProviderSpec): StepRequest {
  const b = (body ?? {}) as { prompt?: unknown; maxTokens?: unknown };
  return {
    kind: spec.kind,
    prompt: typeof b.prompt === "string" ? b.prompt : "",
    maxTokens: typeof b.maxTokens === "number" && b.maxTokens > 0 ? Math.min(b.maxTokens, 32_000) : undefined,
  };
}

/**
 * Our own inference providers as x402 endpoints, paid per request through Metal clearing.
 * POST /p/:id answers a 402 whose amount is the live price for that request body, then,
 * once paid, streams the answer in chunks.
 */
export async function startProviderServer(opts: ProviderServerOptions): Promise<ProviderServer> {
  const specs = opts.specs ?? CATALOG;
  const state = new Map(specs.map((s) => [s.id, { ...DEFAULT_STATE }]));
  const wallets = await Promise.all(specs.map((s) => openClearingWallet(`${opts.walletRoot}/${s.id}`)));

  const facilitator = new HTTPFacilitatorClient({ url: opts.facilitatorUrl ?? METAL_NETWORKS.testnet.facilitatorUrl });
  const resourceServer = registerMetalScheme(new x402ResourceServer(facilitator), { networks: ["testnet"] }).register(
    NETWORK,
    new ClearingServerScheme(NETWORK),
  );

  const routes = Object.fromEntries(
    specs.map((spec, i) => [
      `POST /p/${spec.id}`,
      {
        accepts: [
          {
            scheme: "bajillion",
            network: NETWORK,
            payTo: wallets[i].signer.publicKey,
            // Read on every request: the price depends on this request's size and the provider's state now.
            price: (ctx: { adapter: { getBody?(): unknown } }) => ({
              amount: microsToBase(quote(spec, state.get(spec.id)!, stepRequest(ctx.adapter.getBody?.(), spec))).toString(),
              asset: "0x000000000000000000000000000000000000B5d5",
            }),
          },
        ],
        description: `${spec.name} ${spec.kind}`,
      },
    ]),
  );

  const app = express();
  app.use(express.json({ limit: "256kb" }));

  // Local-only controls for the demo: slow a provider down, change its price, take it offline.
  app.post("/admin/:id", (req: Request, res: Response) => {
    const ip = req.socket.remoteAddress ?? "";
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) return void res.status(403).end();
    const s = state.get(String(req.params.id));
    if (!s) return void res.status(404).end();
    const b = req.body as Partial<ProviderState>;
    if (typeof b.slowFactor === "number" && b.slowFactor > 0) s.slowFactor = b.slowFactor;
    if (typeof b.priceFactor === "number" && b.priceFactor > 0) s.priceFactor = b.priceFactor;
    if (typeof b.down === "boolean") s.down = b.down;
    res.json(s);
  });

  // Unpaid health check so callers can skip a provider that is down before reading its price.
  app.get("/p/:id", (req: Request, res: Response) => {
    const s = state.get(String(req.params.id));
    if (!s) return void res.status(404).end();
    res.status(s.down ? 503 : 200).json({ id: req.params.id, down: s.down });
  });

  app.use((req, res, next) => {
    const id = req.path.startsWith("/p/") ? req.path.slice(3) : null;
    if (id && state.get(id)?.down) return void res.status(503).json({ error: "provider offline" });
    next();
  });

  app.use(paymentMiddleware(routes as never, resourceServer));

  for (const spec of specs) {
    app.post(`/p/${spec.id}`, async (req: Request, res: Response) => {
      const s = state.get(spec.id)!;
      const step = stepRequest(req.body, spec);
      const chunks = standInAnswer(spec, step);
      const total = latencyMs(spec, s, step);
      res.setHeader("content-type", "text/plain; charset=utf-8");
      await sleep(Math.round(total * 0.4));
      const per = Math.round((total * 0.6) / chunks.length);
      for (const c of chunks) {
        res.write(c);
        await sleep(per);
      }
      res.end();
    });
  }

  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(opts.port, "127.0.0.1", () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${opts.port}`,
    state,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      await Promise.all(wallets.map((w) => w.close()));
    },
  };
}
