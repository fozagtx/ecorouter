import { EcoRouter } from "ecorouter";

// `paymentClient` is the local Stellar/x402 integration: it reads the deployed
// mandate and signs inside this process. Secrets are never sent to EcoRouter.
const paymentClient = createStellarPaymentClient();
const router = new EcoRouter({
  account: process.env.ECOROUTER_ACCOUNT ?? process.env.ARBITER_ACCOUNT!,
  sessionSecret: process.env.ECOROUTER_SESSION_SECRET ?? process.env.ARBITER_SESSION_SECRET!,
  paymentClient,
  providers: [
    { id: "search-a", capability: "web.search", endpoint: process.env.SEARCH_A_URL!, qualityScore: 0.82 },
    { id: "search-b", capability: "web.search", endpoint: process.env.SEARCH_B_URL!, qualityScore: 0.93 }
  ]
});

console.log(await router.execute({
  capability: "web.search",
  input: { query: "latest lithium carbonate prices" },
  policy: { maxSpendUsdc: "0.05", minimumQuality: 0.8 }
}));

function createStellarPaymentClient(): never {
  throw new Error("Configure the supported Stellar x402 payment client before running this example");
}
