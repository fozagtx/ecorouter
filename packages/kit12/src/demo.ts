#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { AirwallexClient, AirwallexHolds, FloatLedger, formatUsd, type HoldRail } from "ecorouter";
import { SourcingAgent, type AgentEvent, type ApprovalRequest, type Judge } from "./agent.js";
import { CATALOG } from "./catalog.js";
import { claudeJudge } from "./claude-judge.js";
import { SimRail, type PaymentRail } from "./rails.js";
import { DEMO_FLOAT, DEMO_FLOOR, demoJobs } from "./scenario.js";
import { SimHolds } from "./sim-holds.js";

const env = process.env;
const interactive = process.argv.includes("--ask");

function line(e: AgentEvent) {
  const t = new Date().toISOString().slice(11, 19);
  switch (e.type) {
    case "job_opened": return `${t} ${e.jobId}  card hold placed for ${formatUsd(e.hold, 2)}`;
    case "quotes": return `${t} ${e.jobId}  ${e.stepId.padEnd(6)} offers: ${e.offers.map((o) => `${o.providerId} ${Number.isNaN(o.amount) ? "-" : formatUsd(o.amount)}${o.skip ? ` (${o.skip})` : ""}`).join(", ")}`;
    case "judge": return `${t} ${e.jobId}  ${e.stepId.padEnd(6)} judge: ${e.premium ? "premium" : "cheapest"}, ${e.why}`;
    case "deposit": return `${t} ${e.jobId}  deposit ${formatUsd(e.amount)} into clearing${e.tx ? ` (tx ${e.tx})` : ""}`;
    case "step_paid": return `${t} ${e.jobId}  ${e.stepId.padEnd(6)} PAID ${e.providerId} ${formatUsd(e.paid)} in ${e.latencyMs}ms${e.rerouted.length ? `, after rerouting from ${e.rerouted.join(", ")}` : ""}`;
    case "reroute": return `${t} ${e.jobId}  ${e.stepId.padEnd(6)} reroute away from ${e.from}: ${e.reason}`;
    case "ration": return `${t} ${e.jobId}  ration: ${e.action}, ${e.detail}`;
    case "approval": return `${t} ${e.jobId}  ${e.request.customer} ${e.approved ? "APPROVED" : "DECLINED"} raising the hold ${formatUsd(e.request.currentHold, 2)} -> ${formatUsd(e.request.newHold, 2)}`;
    case "job_paused": return `${t} ${e.jobId}  paused: ${e.reason}`;
    case "job_settled": return `${t} ${e.jobId}  settled: captured ${formatUsd(e.captured, 4)}, released ${formatUsd(e.released, 4)}, deposit withdrawal ${e.withdraw}`;
    case "job_failed": return `${t} ${e.jobId}  FAILED: ${e.reason}`;
  }
}

async function approve(r: ApprovalRequest): Promise<boolean> {
  console.log(`\n  >> ${r.customer} is asked to raise the hold on ${r.jobId} from ${formatUsd(r.currentHold, 2)} to ${formatUsd(r.newHold, 2)} ${r.currency}`);
  console.log(`     reason: ${r.reason}`);
  if (!interactive) {
    console.log("     (auto-approved; run with --ask to decide yourself)\n");
    return true;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("     approve? [y/N] ");
  rl.close();
  return answer.trim().toLowerCase().startsWith("y");
}

async function main() {
  // Payments: Metal testnet when configured, otherwise the simulator with the same rules.
  let rail: PaymentRail;
  if (env.METAL_RPC_URL && env.METAL_FLOAT_KEY && env.PROVIDERS_URL) {
    const { MetalRail } = await import("./metal-rail.js");
    rail = new MetalRail({ providersUrl: env.PROVIDERS_URL, rpcUrl: env.METAL_RPC_URL, floatPrivateKey: env.METAL_FLOAT_KEY as `0x${string}`, walletRoot: env.METAL_WALLETS ?? ".wallets/jobs" });
  } else {
    const sim = new SimRail(CATALOG, Number(env.SIM_TIME_SCALE ?? 0.2));
    rail = sim;
  }
  // Card holds: Airwallex sandbox when configured, otherwise simulated.
  const holds: HoldRail =
    env.AIRWALLEX_CLIENT_ID && env.AIRWALLEX_API_KEY
      ? new AirwallexHolds(new AirwallexClient({ clientId: env.AIRWALLEX_CLIENT_ID, apiKey: env.AIRWALLEX_API_KEY, env: "sandbox" }))
      : new SimHolds();
  const judge: Judge | undefined = env.ANTHROPIC_API_KEY ? claudeJudge({ apiKey: env.ANTHROPIC_API_KEY, model: env.ECOROUTER_JUDGE_MODEL }) : undefined;

  const ledger = new FloatLedger(DEMO_FLOAT, DEMO_FLOOR);
  const jobs = demoJobs(rail instanceof SimRail ? 6_000 : Number(env.LATENCY_TARGET_MS ?? 15_000));
  console.log(`EcoRouter · Kit 12 Inference Sourcing Agent`);
  console.log(`payments: ${rail.name} · holds: ${holds instanceof SimHolds ? "simulated" : "airwallex sandbox"} · judge: ${judge ? "claude" : "rule"}`);
  console.log(`float ${formatUsd(DEMO_FLOAT, 2)} (floor ${formatUsd(DEMO_FLOOR, 2)}), budgets ${jobs.map((j) => `${j.id} ${formatUsd(j.budget, 2)}`).join(", ")}\n`);

  let plans = 0;
  const agent = new SourcingAgent({
    rail,
    holds,
    ledger,
    judge,
    approve,
    onEvent: (e) => {
      console.log(line(e));
      // Midway: once every job has its plan, the cheapest model provider slows under load.
      if (e.type === "step_paid" && e.stepId === "plan" && ++plans === jobs.length) {
        if (rail instanceof SimRail) rail.state.get("swift")!.slowFactor = 8;
        else
          void fetch(`${env.PROVIDERS_URL}/admin/swift`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ slowFactor: 8 }),
          });
        console.log(`\n  >> swift slows down under load (8x latency)\n`);
      }
    },
  });

  const reports = await agent.runAll(jobs);
  console.log("\nSummary");
  for (const r of reports) console.log(`  ${r.jobId}  ${r.status.padEnd(6)}  spent ${formatUsd(r.spent)}  captured ${formatUsd(r.captured, 4)}`);
  console.log(`  float now ${formatUsd(ledger.balance())} (started ${formatUsd(DEMO_FLOAT)})`);
  await rail.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
