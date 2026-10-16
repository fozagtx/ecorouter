import type { PayOutcome } from "./index.js";
import { parseUsdc } from "./money.js";

export const PAY_USAGE = "Usage: ecorouter-agent pay --service <id> --amount <usdc> [--memo <text>] [--key <64hex>]";

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export interface PayCliArgs {
  service: string;
  amount: string;
  memo?: string;
  key?: string;
}

export function parsePayArguments(argv: readonly string[]): PayCliArgs {
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (!["--service", "--amount", "--memo", "--key"].includes(flag)) {
      throw new CliUsageError(`Unknown option: ${flag}`);
    }
    if (options.has(flag)) throw new CliUsageError(`Option may only be provided once: ${flag}`);
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new CliUsageError(`Missing value for ${flag}`);
    options.set(flag, value);
  }

  const service = options.get("--service");
  const amount = options.get("--amount");
  if (!service || !amount) throw new CliUsageError("Both --service and --amount are required.");
  try {
    parseUsdc(amount);
  } catch {
    throw new CliUsageError("--amount must be a USDC decimal with at most seven decimal places.");
  }

  const key = options.get("--key");
  if (key !== undefined && !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new CliUsageError("--key must contain exactly 64 hexadecimal characters.");
  }

  return {
    service,
    amount,
    ...(options.has("--memo") ? { memo: options.get("--memo")! } : {}),
    ...(key !== undefined ? { key } : {}),
  };
}

export function serializePayOutcome(outcome: PayOutcome): string {
  return JSON.stringify(outcome, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value);
}

export function payExitCode(outcome: PayOutcome): 0 | 3 | 4 {
  if (outcome.status === "paid") return 0;
  return outcome.status === "refused" ? 3 : 4;
}
