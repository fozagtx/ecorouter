import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Keypair } from "@stellar/stellar-sdk";
import {
  parseCreateAgentArguments,
  validateAgentProjectOptions,
  writeAgentProject,
} from "../dist/builder.js";

const validOptions = {
  id: "agent_1",
  name: "Example agent",
  kind: "mcp",
  task: "Uppercase text using a connected API",
  price: "0.005",
  method: "POST",
};

test("create-agent validates the registry slug, positive USDC price, and UTF-8 task limit", () => {
  assert.doesNotThrow(() => validateAgentProjectOptions(validOptions));
  assert.throws(() => validateAgentProjectOptions({ ...validOptions, id: "ten_chars_1" }), /--id must match/);
  assert.throws(() => validateAgentProjectOptions({ ...validOptions, id: "Upper" }), /--id must match/);
  assert.throws(() => validateAgentProjectOptions({ ...validOptions, price: "0" }), /positive USDC/);
  assert.throws(() => validateAgentProjectOptions({ ...validOptions, price: "0.00000001" }), /positive USDC/);
  assert.doesNotThrow(() => validateAgentProjectOptions({ ...validOptions, task: "é".repeat(140) }));
  assert.throws(() => validateAgentProjectOptions({ ...validOptions, task: "é".repeat(141) }), /280 UTF-8 bytes/);
});

test("create-agent parses flags and writes the project with its secret only in .env", async () => {
  const parsed = parseCreateAgentArguments([
    "/tmp/example",
    "--name", "Example agent",
    "--id", "agent_1",
    "--kind", "mcp",
    "--task", "Uppercase text",
    "--price", "0.005",
    "--upstream", "http://localhost:9000/uppercase",
    "--method", "post",
  ]);
  assert.deepEqual(parsed, {
    directory: "/tmp/example",
    options: {
      name: "Example agent",
      id: "agent_1",
      kind: "mcp",
      task: "Uppercase text",
      price: "0.005",
      upstream: "http://localhost:9000/uppercase",
      method: "POST",
    },
  });

  const root = await mkdtemp(join(tmpdir(), "ecorouter-builder-"));
  const directory = join(root, "project");
  const keypair = Keypair.random();
  const secret = keypair.secret();
  try {
    const metadata = await writeAgentProject(directory, {
      ...validOptions,
      upstream: "http://localhost:9000/uppercase",
    }, keypair);
    const files = (await readdir(directory)).sort();
    assert.deepEqual(files, [
      ".ecorouter.json",
      ".env",
      ".gitignore",
      "README.md",
      "agent.py",
      "render.yaml",
      "requirements.txt",
      "server.py",
    ]);
    assert.equal(metadata.seller, keypair.publicKey());
    assert.equal(metadata.payee, keypair.publicKey());

    const env = await readFile(join(directory, ".env"), "utf8");
    assert.ok(env.includes(`SELLER_SECRET=${secret}`));
    assert.equal((await stat(join(directory, ".env"))).mode & 0o777, 0o600);
    for (const file of files.filter((name) => name !== ".env")) {
      assert.equal((await readFile(join(directory, file), "utf8")).includes(secret), false, file);
    }

    const agent = await readFile(join(directory, "agent.py"), "utf8");
    const server = await readFile(join(directory, "server.py"), "utf8");
    const requirements = await readFile(join(directory, "requirements.txt"), "utf8");
    const render = await readFile(join(directory, "render.yaml"), "utf8");
    const gitignore = await readFile(join(directory, ".gitignore"), "utf8");
    assert.match(agent, /async def handle\(input: dict\) -> dict:/);
    assert.match(agent, /json\.dumps\(input\)\.encode/);
    assert.match(server, /from mcp\.server\.fastmcp import FastMCP/);
    assert.match(server, /@server\.tool\(name="agent_1", description="Uppercase text using a connected API"\)/);
    assert.match(server, /Route\("\/health"/);
    assert.equal(requirements, "mcp==1.30.0\nuvicorn==0.54.0\nstarlette==1.8.0\n");
    assert.match(render, /healthCheckPath: \/health/);
    assert.match(render, /key: UPSTREAM_AUTH\s+sync: false/);
    assert.match(gitignore, /^\.env$/m);
    assert.match(gitignore, /^\.ecorouter\.json$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("create-agent generates a clearly marked handler stub when no upstream is set", async () => {
  const root = await mkdtemp(join(tmpdir(), "ecorouter-builder-stub-"));
  const keypair = Keypair.random();
  try {
    await writeAgentProject(join(root, "project"), validOptions, keypair);
    const agent = await readFile(join(root, "project", "agent.py"), "utf8");
    assert.match(agent, /raise NotImplementedError\("write your task here"\)/);
    assert.doesNotMatch(agent, /return \{"(?:result|text)":/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
