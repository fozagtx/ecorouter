import { TeamAgent, TESTNET, formatUsdc, parseUsdc, scheduleKey } from "./index.js";
import { CliUsageError, PAY_USAGE, parsePayArguments, payExitCode, serializePayOutcome } from "./cli.js";

const scheduledUsage = "Usage: AGENT_SECRET=... AGENT_SERVICE=search AGENT_AMOUNT=0.25 [AGENT_EVERY=hour|day|week] [AGENT_MEMO=...] [TEAM_ACCOUNT_ID=...] [RPC_URL=...] node packages/sdk/dist/worker.js";
const argv = process.argv.slice(2);

const secret = process.env.AGENT_SECRET;
const service = process.env.AGENT_SERVICE;
const amountText = process.env.AGENT_AMOUNT;
const every = process.env.AGENT_EVERY ?? "day";
const memo = process.env.AGENT_MEMO ?? "";
const team = process.env.TEAM_ACCOUNT_ID ?? TESTNET.teamAccount;
const rpcUrl = process.env.RPC_URL ?? TESTNET.rpcUrl;
const secondsByCadence = { hour: 3_600, day: 86_400, week: 604_800 } as const;

if (argv[0] === "pay") {
  try {
    const input = parsePayArguments(argv.slice(1));
    if (!secret) throw new CliUsageError("AGENT_SECRET is required for one-shot payments.");
    const outcome = await new TeamAgent({ secret, teamAccount: team, rpcUrl }).pay(input);
    console.log(serializePayOutcome(outcome));
    process.exitCode = payExitCode(outcome);
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(`${error.message}\n${PAY_USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
} else if (argv[0] === "fetch") {
  try {
    const url = argv[1];
    if (!url || argv.length > 4) throw new CliUsageError("Usage: ecorouter-agent fetch <url> [--data json]");
    let data: string | undefined;
    if (argv.length > 2) {
      if (argv[2] !== "--data" || argv[3] === undefined) throw new CliUsageError("Usage: ecorouter-agent fetch <url> [--data json]");
      JSON.parse(argv[3]);
      data = argv[3];
    }
    if (!secret) throw new CliUsageError("AGENT_SECRET is required for fetch.");
    const result = await new TeamAgent({ secret, teamAccount: team, rpcUrl }).fetch(url, data === undefined
      ? undefined
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: data });
    console.log(JSON.stringify({
      status: result.response.status,
      body: await result.response.text(),
      payment: result.payment,
      rule: result.rule,
    }));
    if (result.rule !== undefined) process.exitCode = 3;
  } catch (error) {
    if (error instanceof CliUsageError || error instanceof SyntaxError) {
      console.error(`${error.message}\nUsage: ecorouter-agent fetch <url> [--data json]`);
      process.exitCode = 2;
    } else {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
} else if (argv.length > 0) {
  console.error(`Unknown subcommand: ${argv[0]}\n${scheduledUsage}\n${PAY_USAGE}`);
  process.exitCode = 2;
} else if (!secret || !service || !amountText || !Object.hasOwn(secondsByCadence, every)) {
  console.error(scheduledUsage);
  process.exitCode = 1;
} else {
  let amount: bigint;
  try {
    amount = parseUsdc(amountText);
    if (amount <= 0n) throw new Error("AGENT_AMOUNT must be greater than zero.");
  } catch (error) {
    console.error(`${scheduledUsage}\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }

  if (process.exitCode !== 1) {
    const agent = new TeamAgent({ secret, teamAccount: team, rpcUrl });
    const cadenceSeconds = secondsByCadence[every as keyof typeof secondsByCadence];
    const finished = new Set<string>();
    const pending = new Map<string, { retryAt: number }>();

    const log = (event: string, fields: Record<string, unknown>) => {
      console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
    };

    const processKey = async (key: string, retryAt?: number) => {
      try {
        if (await agent.reconcile(key) === "paid") {
          pending.delete(key);
          finished.add(key);
          log("reconciled_paid", { key, service, amount: formatUsdc(amount) });
          return;
        }
        const outcome = await agent.pay({ service, amount, memo, key });
        if (outcome.status === "paid") {
          pending.delete(key);
          finished.add(key);
          log("paid", { key, service, amount: formatUsdc(amount), txHash: outcome.txHash, explorerUrl: outcome.explorerUrl });
        } else if (outcome.status === "refused") {
          pending.delete(key);
          finished.add(key);
          log("refused", { key, service, amount: formatUsdc(amount), rule: outcome.rule, reason: outcome.reason, overBy: outcome.overBy.toString() });
        } else {
          const nextRetryAt = Date.now() + 150_000;
          pending.set(key, { retryAt: nextRetryAt });
          log("pending", { key, service, amount: formatUsdc(amount), txHash: outcome.txHash, retryAt: new Date(nextRetryAt).toISOString() });
        }
      } catch (error) {
        log("error", { key, service, amount: formatUsdc(amount), message: error instanceof Error ? error.message : String(error), retryAt });
      }
    };

    const tick = async () => {
      const now = Date.now();
      for (const [key, job] of pending) {
        if (job.retryAt <= now) await processKey(key, job.retryAt);
      }
      const slot = Math.floor(Math.floor(Date.now() / 1_000) / cadenceSeconds);
      const key = scheduleKey(team, agent.address, service, slot);
      if (!finished.has(key) && !pending.has(key)) await processKey(key);
    };

    void (async () => {
      await tick();
      while (process.exitCode !== 1) {
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        await tick();
      }
    })().catch((error: unknown) => {
      log("fatal", { message: error instanceof Error ? error.message : String(error) });
      process.exitCode = 1;
    });
  }
}
