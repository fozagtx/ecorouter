import { Pool } from "pg";
import deployment from "../../../deployments/testnet.json" with { type: "json" };
import { ChainRegistry, createGateway, PostgresUpstreams } from "./index.js";
const port = Number(process.env.PORT ?? 8787);
const publicUrl = process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL;
if (!publicUrl)
    throw new Error("PUBLIC_URL or RENDER_EXTERNAL_URL is required");
const normalizedPublicUrl = publicUrl.startsWith("http") ? publicUrl : `https://${publicUrl}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const upstreams = new PostgresUpstreams(pool);
await upstreams.initialize();
const listings = new ChainRegistry(deployment.registry.contractId, process.env.RPC_URL ?? deployment.rpcUrl);
const nebius = await listings.get("nebius_llm");
if (nebius && process.env.NEBIUS_API_KEY) {
    await upstreams.put({
        id: nebius.id, kind: "api", url: "builtin:nebius", auth_header: null, seller: nebius.seller,
    });
}
const app = createGateway({
    listings,
    upstreams,
    facilitatorUrl: process.env.FACILITATOR_URL ?? "https://www.x402.org/facilitator",
    localFacilitatorUrl: process.env.LOCAL_FACILITATOR_URL,
    usdc: deployment.usdc,
    publicUrl: normalizedPublicUrl,
    nodeEnv: process.env.NODE_ENV,
    nebiusApiKey: process.env.NEBIUS_API_KEY,
});
app.listen(port, () => console.log(`EcoRouter gateway listening on ${port}`));
