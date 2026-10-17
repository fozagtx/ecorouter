import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";

const keys = JSON.parse(await readFile(resolve(import.meta.dirname, "../../.deploy/testnet-keys.json"), "utf8"));
const exact = new ExactStellarScheme([createEd25519Signer(keys.facilitator)], {
  rpcConfig: { url: "https://soroban-testnet.stellar.org" },
  areFeesSponsored: true,
  maxTransactionFeeStroops: 100_000_000,
});
const validate = exact.validateSimulationEvents.bind(exact);
exact.validateSimulationEvents = (events, ...args) => {
  const topics = events.flatMap((diagnosticEvent) => {
    const event = diagnosticEvent.event();
    if (event.type().name !== "contract") return [];
    return [event.body().v0().topics().map((topic) =>
      topic.switch().name === "scvSymbol" ? topic.sym().toString() : topic.switch().name)];
  });
  console.info(`local facilitator simulation event topics: ${JSON.stringify(topics)}`);
  return validate(events, ...args);
};
const facilitator = new x402Facilitator().register("stellar:testnet", exact);
const app = express();
app.use(express.json());
app.get("/supported", (_req, res) => res.json(facilitator.getSupported()));
app.post("/verify", async (req, res) => {
  try { res.json(await facilitator.verify(req.body.paymentPayload, req.body.paymentRequirements)); }
  catch (error) { res.status(400).json({ error: String(error) }); }
});
app.post("/settle", async (req, res) => {
  try { res.json(await facilitator.settle(req.body.paymentPayload, req.body.paymentRequirements)); }
  catch (error) { res.status(400).json({ error: String(error) }); }
});
const server = createServer(app);
server.listen(Number(process.env.PORT ?? 8788), "127.0.0.1", () => {
  console.log(`local facilitator listening on ${process.env.PORT ?? 8788}`);
});
