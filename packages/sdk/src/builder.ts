import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve, join } from "node:path";
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import deployment from "../../../deployments/testnet.json" with { type: "json" };
import { CliUsageError } from "./cli.js";
import { parseUsdc } from "./money.js";
import { TESTNET } from "./index.js";

const MCP_VERSION = "1.30.0";
const UVICORN_VERSION = "0.54.0";
const STARLETTE_VERSION = "1.8.0";
const USDC_CODE = "USDC";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const FRIEND_BOT_URL = "https://friendbot.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";

export interface AgentProjectOptions {
  id: string;
  name: string;
  kind: "api" | "mcp";
  task: string;
  price: string;
  upstream?: string;
  method: "GET" | "POST";
}

export interface AgentProjectMetadata extends AgentProjectOptions {
  seller: string;
  payee: string;
  gatewayUrl?: string;
}

interface DeploymentWithGateway {
  gateway?: { url?: string | null } | null;
}

function validateAgentProject(options: AgentProjectOptions): void {
  if (!/^[a-z0-9_]{1,9}$/.test(options.id)) {
    throw new CliUsageError("--id must match [a-z0-9_]{1,9}.");
  }
  if (!options.name.trim()) throw new CliUsageError("--name must not be empty.");
  if (options.kind !== "api" && options.kind !== "mcp") {
    throw new CliUsageError("--kind must be api or mcp.");
  }
  if (!options.task.trim()) throw new CliUsageError("--task must not be empty.");
  if (Buffer.byteLength(options.task, "utf8") > 280) {
    throw new CliUsageError("--task must be at most 280 UTF-8 bytes.");
  }
  try {
    if (parseUsdc(options.price) <= 0n) throw new Error();
  } catch {
    throw new CliUsageError("--price must be a positive USDC decimal with at most seven decimal places.");
  }
  if (options.method !== "GET" && options.method !== "POST") {
    throw new CliUsageError("--method must be GET or POST.");
  }
  if (options.upstream) {
    let url: URL;
    try {
      url = new URL(options.upstream);
    } catch {
      throw new CliUsageError("--upstream must be an absolute HTTP or HTTPS URL.");
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new CliUsageError("--upstream must use HTTP or HTTPS.");
    }
  }
}

export function validateAgentProjectOptions(options: AgentProjectOptions): void {
  validateAgentProject(options);
}

function pyString(value: string): string {
  return JSON.stringify(value);
}

function agentSource(options: AgentProjectOptions): string {
  const upstream = options.upstream;
  if (!upstream) {
    return `async def handle(input: dict) -> dict:
    """Implement this task before deploying the agent."""
    raise NotImplementedError("write your task here")
`;
  }

  return `import asyncio
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

UPSTREAM_URL = os.environ.get("UPSTREAM_URL", ${pyString(upstream)})
UPSTREAM_METHOD = ${pyString(options.method)}


def _query_value(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"))
    return "" if value is None else str(value)


def _call_upstream(input: dict) -> dict:
    headers = {"Accept": "application/json"}
    upstream_auth = os.environ.get("UPSTREAM_AUTH")
    if upstream_auth:
        headers["Authorization"] = upstream_auth

    body = None
    url = UPSTREAM_URL
    if UPSTREAM_METHOD == "POST":
        headers["Content-Type"] = "application/json"
        body = json.dumps(input).encode("utf-8")
    else:
        parsed = urlsplit(url)
        query = parse_qsl(parsed.query, keep_blank_values=True)
        query.extend((str(key), _query_value(value)) for key, value in input.items())
        url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))

    request = Request(url, data=body, headers=headers, method=UPSTREAM_METHOD)
    try:
        with urlopen(request, timeout=60) as response:
            raw = response.read()
    except HTTPError as error:
        message = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Upstream returned HTTP {error.code}: {message}") from error
    except URLError as error:
        raise RuntimeError(f"Could not reach upstream: {error.reason}") from error

    text = raw.decode("utf-8")
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        return {"text": text}
    return result if isinstance(result, dict) else {"result": result}


async def handle(input: dict) -> dict:
    return await asyncio.to_thread(_call_upstream, input)
`;
}

function serverSource(options: AgentProjectOptions): string {
  return `import os

import uvicorn
from mcp.server.fastmcp import FastMCP
from starlette.responses import JSONResponse
from starlette.routing import Route

from agent import handle

server = FastMCP(${pyString(options.name)})


@server.tool(name=${pyString(options.id)}, description=${pyString(options.task)})
async def invoke(input: dict) -> dict:
    return await handle(input)


async def health(_request):
    return JSONResponse({"status": "ok"})


app = server.streamable_http_app()
app.routes.append(Route("/health", endpoint=health, methods=["GET"]))


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
`;
}

function renderSource(options: AgentProjectOptions): string {
  const upstreamEnv = options.upstream
    ? `      - key: UPSTREAM_URL
        value: ${pyString(options.upstream)}
`
    : "";
  return `services:
  - type: web
    name: ecorouter-agent-${options.id}
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: python server.py
    healthCheckPath: /health
    envVars:
${upstreamEnv}      - key: UPSTREAM_AUTH
        sync: false
`;
}

function readmeSource(options: AgentProjectOptions): string {
  return `# ${options.name}

This project exposes one Streamable HTTP MCP tool at \`/mcp\`. Its listing ID is \`${options.id}\`; its task is: ${options.task}

## Deploy and sell

1. **Deploy on Render.** Create a new Blueprint from this repository or upload \`render.yaml\`. Render installs the pinned Python MCP SDK and starts the service; set \`UPSTREAM_AUTH\` only if your API requires it.
2. **List it on testnet.** From this directory, run \`ecorouter list\`. Set \`ECOROUTER_GATEWAY_URL\` or pass \`--gateway\` if you want the on-chain URL to point to a gateway. Use \`--dry-run\` to simulate without submitting.
3. **Connect it to the gateway.** Run \`ecorouter connect --url https://<your-render-host>/mcp\`. The gateway stores the endpoint privately; the on-chain listing contains only public metadata and its gateway URL.

The generated seller key is stored in the mode-600, gitignored \`.env\`. Keep that file private. Its testnet account is funded by Friendbot; it is not a production key.

${options.upstream ? "The API wrapper forwards POST input as JSON. For GET, input fields are encoded as query parameters. Non-2xx upstream responses fail the MCP call rather than returning placeholder data." : "The generated handler is an explicit stub and raises `NotImplementedError(\"write your task here\")`; implement `handle` before listing this agent as usable."}

> **NANDA discovery TODO:** \`nanda-adapter==1.0.1\` was inspected, but it creates a separate A2A AgentBridge with a message-improver callback. Its registry helper advertises A2A endpoints, not MCP Streamable HTTP tools, so this project does not register an MCP URL as if it were an A2A agent.

An upstream can fail after an x402 payment has settled. In that case the gateway returns an error with the settlement receipt; the payment is not automatically reversed.
`;
}

async function assertEmptyOrMissingDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const files = await readdir(directory);
  if (files.length > 0) {
    throw new CliUsageError(`Refusing to write into non-empty directory: ${directory}`);
  }
}

export async function writeAgentProject(
  directory: string,
  options: AgentProjectOptions,
  keypair: Keypair,
): Promise<AgentProjectMetadata> {
  validateAgentProject(options);
  const target = resolve(directory);
  await assertEmptyOrMissingDirectory(target);
  const metadata: AgentProjectMetadata = {
    ...options,
    seller: keypair.publicKey(),
    payee: keypair.publicKey(),
  };
  const files: Record<string, string> = {
    "agent.py": agentSource(options),
    "server.py": serverSource(options),
    "requirements.txt": `mcp==${MCP_VERSION}\nuvicorn==${UVICORN_VERSION}\nstarlette==${STARLETTE_VERSION}\n`,
    "render.yaml": renderSource(options),
    "README.md": readmeSource(options),
    ".gitignore": ".env\n.ecorouter.json\n.venv/\n__pycache__/\n*.py[cod]\n",
    ".ecorouter.json": `${JSON.stringify(metadata, null, 2)}\n`,
  };
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(target, name), contents, { mode: 0o644 });
  }
  await writeFile(join(target, ".env"), `SELLER_SECRET=${keypair.secret()}\nUPSTREAM_AUTH=\n`, { mode: 0o600 });
  await chmod(join(target, ".env"), 0o600);
  return metadata;
}

export function parseCreateAgentArguments(argv: readonly string[]): {
  directory: string;
  options: Partial<AgentProjectOptions>;
} {
  const directory = argv[0];
  if (!directory || directory.startsWith("--")) {
    throw new CliUsageError("Usage: ecorouter create-agent <dir> [--name --id --kind api|mcp --task --price --upstream <url> --method GET|POST]");
  }
  const allowed = new Set(["--name", "--id", "--kind", "--task", "--price", "--upstream", "--method"]);
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (!allowed.has(flag)) throw new CliUsageError(`Unknown create-agent option: ${flag}`);
    if (values.has(flag)) throw new CliUsageError(`Option may only be provided once: ${flag}`);
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new CliUsageError(`Missing value for ${flag}`);
    values.set(flag, value);
  }
  const kind = values.get("--kind");
  const method = values.get("--method");
  return {
    directory,
    options: {
      ...(values.has("--name") ? { name: values.get("--name")! } : {}),
      ...(values.has("--id") ? { id: values.get("--id")! } : {}),
      ...(kind ? { kind: kind as "api" | "mcp" } : {}),
      ...(values.has("--task") ? { task: values.get("--task")! } : {}),
      ...(values.has("--price") ? { price: values.get("--price")! } : {}),
      ...(values.has("--upstream") ? { upstream: values.get("--upstream")! } : {}),
      ...(method ? { method: method.toUpperCase() as "GET" | "POST" } : {}),
    },
  };
}

async function promptForCreateAgent(initial: Partial<AgentProjectOptions>): Promise<AgentProjectOptions> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = async (key: keyof AgentProjectOptions, label: string) => {
      const value = initial[key];
      if (typeof value === "string" && value.length > 0) return value;
      return rl.question(`${label}: `);
    };
    const name = await answer("name", "Agent name");
    const id = await answer("id", "Listing ID (1-9 lowercase letters, digits, or underscores)");
    const kind = await answer("kind", "Kind (api or mcp)");
    const task = await answer("task", "Task description (up to 280 UTF-8 bytes)");
    const price = await answer("price", "Price in USDC");
    const options: AgentProjectOptions = {
      name,
      id,
      kind: kind as "api" | "mcp",
      task,
      price,
      method: initial.method ?? "POST",
      ...(initial.upstream ? { upstream: initial.upstream } : {}),
    };
    validateAgentProject(options);
    return options;
  } finally {
    rl.close();
  }
}

function normalizeGatewayUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function deploymentGatewayUrl(): string | null {
  return normalizeGatewayUrl((deployment as unknown as DeploymentWithGateway).gateway?.url);
}

function gatewayFromListArgs(value: string | undefined): string | null {
  return normalizeGatewayUrl(value) ??
    normalizeGatewayUrl(process.env.ECOROUTER_GATEWAY_URL) ??
    deploymentGatewayUrl();
}

function parseEnvFile(content: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

async function readProject(directory: string): Promise<{
  path: string;
  metadata: AgentProjectMetadata;
  env: Record<string, string>;
}> {
  const path = resolve(directory);
  let metadata: AgentProjectMetadata;
  let env: Record<string, string>;
  try {
    metadata = JSON.parse(await readFile(join(path, ".ecorouter.json"), "utf8")) as AgentProjectMetadata;
    env = parseEnvFile(await readFile(join(path, ".env"), "utf8"));
  } catch {
    throw new CliUsageError(`Could not read .ecorouter.json and .env from ${path}. Run create-agent first.`);
  }
  validateAgentProject(metadata);
  if (!metadata.seller || metadata.seller !== metadata.payee) {
    throw new CliUsageError("Project metadata must use the seller as the payee.");
  }
  if (!env.SELLER_SECRET) throw new CliUsageError("SELLER_SECRET is missing from .env.");
  try {
    if (Keypair.fromSecret(env.SELLER_SECRET).publicKey() !== metadata.seller) {
      throw new CliUsageError("SELLER_SECRET does not match the project seller address.");
    }
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError("SELLER_SECRET in .env is invalid.");
  }
  return { path, metadata, env };
}

function parseCommandOptions(argv: readonly string[], allowed: Set<string>): Map<string, string | true> {
  const options = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (!allowed.has(flag)) throw new CliUsageError(`Unknown option: ${flag}`);
    if (options.has(flag)) throw new CliUsageError(`Option may only be provided once: ${flag}`);
    if (flag === "--dry-run") {
      options.set(flag, true);
      continue;
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new CliUsageError(`Missing value for ${flag}`);
    options.set(flag, value);
  }
  return options;
}

async function hasUsdcTrustline(address: string): Promise<boolean> {
  const horizon = new Horizon.Server(HORIZON_URL);
  const account = await horizon.loadAccount(address);
  return account.balances.some((balance) =>
    "asset_code" in balance && balance.asset_code === USDC_CODE && balance.asset_issuer === USDC_ISSUER,
  );
}

async function addUsdcTrustline(keypair: Keypair): Promise<string> {
  const horizon = new Horizon.Server(HORIZON_URL);
  const source = await horizon.loadAccount(keypair.publicKey());
  const transaction = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: new Asset(USDC_CODE, USDC_ISSUER) }))
    .setTimeout(120)
    .build();
  transaction.sign(keypair);
  const result = await horizon.submitTransaction(transaction);
  return result.hash;
}

function listingCall(metadata: AgentProjectMetadata, url: string) {
  return new Contract(TESTNET.registry).call(
    "register",
    new Address(metadata.seller).toScVal(),
    xdr.ScVal.scvSymbol(metadata.id),
    nativeToScVal(metadata.name, { type: "string" }),
    nativeToScVal(metadata.task, { type: "string" }),
    xdr.ScVal.scvSymbol(metadata.kind),
    new Address(metadata.payee).toScVal(),
    nativeToScVal(url, { type: "string" }),
    nativeToScVal(parseUsdc(metadata.price), { type: "i128" }),
  );
}

async function submitListing(
  metadata: AgentProjectMetadata,
  url: string,
  secret: string,
  dryRun: boolean,
): Promise<void> {
  const server = new rpc.Server(TESTNET.rpcUrl);
  const source = await server.getAccount(metadata.seller);
  const transaction = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(listingCall(metadata, url))
    .setTimeout(120)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new Error(`Registry register simulation failed: ${JSON.stringify(simulation)}`);
  }
  if (dryRun) {
    console.log(`Dry run: registry register simulation succeeded (estimated resource fee ${simulation.minResourceFee} stroops).`);
    return;
  }
  const prepared = await server.prepareTransaction(transaction);
  prepared.sign(Keypair.fromSecret(secret));
  const sent = await server.sendTransaction(prepared);
  if (sent.status !== "PENDING") throw new Error(`Registry register submission failed: ${JSON.stringify(sent)}`);
  const result = await server.pollTransaction(sent.hash, { attempts: 40 });
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Registry registration ${result.status.toLowerCase()} (${sent.hash}).`);
  }
  console.log(`Listing transaction: ${sent.hash}`);
  console.log(`Explorer: ${TESTNET.explorer}/tx/${sent.hash}`);
}

async function listCommand(argv: readonly string[]): Promise<void> {
  const options = parseCommandOptions(argv, new Set(["--dir", "--gateway", "--dry-run"]));
  const directory = String(options.get("--dir") ?? ".");
  const { metadata, env } = await readProject(directory);
  const dryRun = options.has("--dry-run");
  const gateway = gatewayFromListArgs(typeof options.get("--gateway") === "string" ? String(options.get("--gateway")) : undefined);
  if (typeof options.get("--gateway") === "string" && gateway && !dryRun) {
    metadata.gatewayUrl = gateway;
    await writeFile(join(resolve(directory), ".ecorouter.json"), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  }
  const url = gateway ? `${gateway}/a/${metadata.id}` : "";
  const keypair = Keypair.fromSecret(env.SELLER_SECRET);
  const hasTrustline = await hasUsdcTrustline(metadata.seller);
  if (!hasTrustline && dryRun) {
    console.log("Dry run: USDC trustline is missing; it would be added before a real listing.");
  } else if (!hasTrustline) {
    const trustlineHash = await addUsdcTrustline(keypair);
    console.log(`USDC trustline transaction: ${trustlineHash}`);
    console.log(`Explorer: ${TESTNET.explorer}/tx/${trustlineHash}`);
  }
  console.log(`Listing ${metadata.id} (${metadata.kind}) for ${metadata.price} USDC; URL ${url || "(empty)"}.`);
  await submitListing(metadata, url, env.SELLER_SECRET, dryRun);
}

async function connectCommand(argv: readonly string[]): Promise<void> {
  const options = parseCommandOptions(argv, new Set(["--url", "--dir", "--gateway"]));
  const upstreamUrl = options.get("--url");
  if (typeof upstreamUrl !== "string") throw new CliUsageError("Usage: ecorouter connect --url https://<host>/mcp [--dir .]");
  const { metadata, env } = await readProject(String(options.get("--dir") ?? "."));
  const gateway = normalizeGatewayUrl(typeof options.get("--gateway") === "string" ? String(options.get("--gateway")) : undefined) ??
    normalizeGatewayUrl(process.env.ECOROUTER_GATEWAY_URL) ??
    normalizeGatewayUrl(metadata.gatewayUrl) ??
    deploymentGatewayUrl();
  if (!gateway) {
    throw new CliUsageError("No gateway URL is configured. Set ECOROUTER_GATEWAY_URL, pass --gateway, or use a deployment with gateway.url.");
  }
  let upstream: URL;
  try {
    upstream = new URL(upstreamUrl);
  } catch {
    throw new CliUsageError("--url must be an absolute URL.");
  }
  if (!["https:", "http:"].includes(upstream.protocol)) throw new CliUsageError("--url must use HTTPS (HTTP is only for local development).");
  const body: { url: string; kind: string; authHeader?: string } = { url: upstream.toString(), kind: metadata.kind };
  if (env.UPSTREAM_AUTH) body.authHeader = env.UPSTREAM_AUTH;
  const bodyText = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1_000);
  const bodyHash = createHash("sha256").update(bodyText, "utf8").digest("hex");
  const message = `ecorouter:upstream:${metadata.id}:${bodyHash}:${timestamp}`;
  const signature = Buffer.from(
    Keypair.fromSecret(env.SELLER_SECRET)
      .sign(createHash("sha256").update(`Stellar Signed Message:\n${message}`, "utf8").digest()),
  ).toString("base64");
  const response = await fetch(`${gateway}/listings/${encodeURIComponent(metadata.id)}/upstream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Stellar-Address": metadata.seller,
      "X-Stellar-Signature": signature,
      "X-Timestamp": String(timestamp),
    },
    body: bodyText,
  });
  if (!response.ok) {
    throw new Error(`Gateway rejected the upstream connection (${response.status}): ${await response.text()}`);
  }
  console.log(`Connected ${metadata.id} to ${upstream.toString()} through ${gateway}.`);
}

async function createAgentCommand(argv: readonly string[]): Promise<void> {
  const { directory, options: initial } = parseCreateAgentArguments(argv);
  const options = await promptForCreateAgent(initial);
  const target = resolve(directory);
  await assertEmptyOrMissingDirectory(target);
  const keypair = Keypair.random();
  const response = await fetch(`${FRIEND_BOT_URL}?addr=${encodeURIComponent(keypair.publicKey())}`);
  if (!response.ok) {
    throw new Error(`Testnet Friendbot funding failed for ${keypair.publicKey()} (HTTP ${response.status}).`);
  }
  const metadata = await writeAgentProject(target, options, keypair);
  console.log(`Created ${metadata.name} in ${target}.`);
  console.log(`Testnet seller and payee: ${metadata.seller}`);
  console.log("The seller secret is stored only in the gitignored .env file (mode 600).");
}

export async function runBuilderCommand(argv: readonly string[]): Promise<boolean> {
  switch (argv[0]) {
    case "create-agent":
      await createAgentCommand(argv.slice(1));
      return true;
    case "list":
      await listCommand(argv.slice(1));
      return true;
    case "connect":
      await connectCommand(argv.slice(1));
      return true;
    default:
      return false;
  }
}
