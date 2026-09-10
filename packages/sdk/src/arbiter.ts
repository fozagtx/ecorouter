import {
  NoEligibleProviderError,
  PaymentAuthorizationError,
  PaymentSettlementError,
  PaymentSettlementUnknownError,
  ProviderExecutionError,
  ProviderResponseError,
} from "./errors.js";
import { formatUsdc } from "./money.js";
import { HttpWebSearchProvider } from "./providers/web-search.js";
import { selectProvider } from "./router/select.js";
import type { ArbiterConfig, ArbiterExecutionResult, ExecuteRequest } from "./types.js";
import { validateChallenge } from "./x402/validate.js";

type State = { status: "running" } | { status: "complete"; result: ArbiterExecutionResult } | { status: "failed" | "settlement_unknown" };

export class Arbiter {
  private readonly executions = new Map<string, State>();
  private readonly metrics = new Map<string, { successCount: number; failureCount: number }>();

  constructor(private readonly config: ArbiterConfig) {
    if (!config.account || !config.sessionSecret || config.providers.length < 2) {
      throw new TypeError("account, sessionSecret, and at least two providers are required");
    }
    const seenIds = new Set<string>();
    for (const p of config.providers) {
      if (seenIds.has(p.id)) {
        throw new TypeError(`Duplicate provider id: ${p.id}`);
      }
      seenIds.add(p.id);
      const url = new URL(p.endpoint);
      if (url.protocol !== "https:") {
        throw new TypeError("Provider endpoints must use HTTPS");
      }
      if (isLocalHostname(url.hostname)) {
        throw new TypeError("Provider endpoints must use a public hostname");
      }
      if (!(p.qualityScore >= 0 && p.qualityScore <= 1)) {
        throw new TypeError("qualityScore must be between 0 and 1");
      }
      this.metrics.set(p.id, { successCount: 0, failureCount: 0 });
    }
  }

  async execute(request: ExecuteRequest): Promise<ArbiterExecutionResult> {
    const executionId = request.executionId ?? crypto.randomUUID();
    const prior = this.executions.get(executionId);
    if (prior?.status === "complete") return prior.result;
    if (prior) throw new Error(`Execution ${executionId} is already ${prior.status}`);
    this.executions.set(executionId, { status: "running" });

    try {
      const mandate = await this.config.paymentClient.loadMandate(this.config.account);
      const adapters = this.config.providers
        .filter((p) => p.capability === request.capability)
        .map((p) => new HttpWebSearchProvider(p, this.config.fetch ?? fetch));

      const timeoutMs = 5000;
      const challenged = await Promise.allSettled(
        adapters.map(async (adapter) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const challengePromise = adapter.challenge(request.input);
            const timeoutPromise = new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error(`Timeout challenging provider ${adapter.id}`)), timeoutMs);
            });
            const challenge = await Promise.race([challengePromise, timeoutPromise]);
            return { adapter, challenge };
          } finally {
            if (timer) clearTimeout(timer);
          }
        })
      );

      const eligible = challenged.flatMap((item) => {
        if (item.status === "rejected" || item.value.adapter.qualityScore < request.policy.minimumQuality) return [];
        try {
          const priceAtomic = validateChallenge(item.value.challenge, mandate, request.policy.maxSpendUsdc, executionId);
          const metric = this.metrics.get(item.value.adapter.id)!;
          const total = metric.successCount + metric.failureCount;
          return [{ ...item.value, priceAtomic, successRate: total ? metric.successCount / total : 1 }];
        } catch {
          return [];
        }
      });

      if (!eligible.length) throw new NoEligibleProviderError(undefined, executionId);

      const winner = selectProvider(
        eligible.map((x) => ({
          providerId: x.adapter.id,
          priceAtomic: x.priceAtomic,
          qualityScore: x.adapter.qualityScore,
          successRate: x.successRate,
        }))
      );
      const selected = eligible.find((x) => x.adapter.id === winner.providerId)!;

      let settlement;
      try {
        settlement = await this.config.paymentClient.authorizeAndSettle({
          account: this.config.account,
          sessionSecret: this.config.sessionSecret,
          executionId,
          providerId: winner.providerId,
          challenge: selected.challenge,
        });
      } catch (cause) {
        if (cause instanceof PaymentAuthorizationError || cause instanceof PaymentSettlementError) {
          throw cause;
        }
        this.executions.set(executionId, { status: "settlement_unknown" });
        throw new PaymentSettlementUnknownError(
          cause instanceof Error ? cause.message : "Settlement status unknown",
          executionId,
          winner.providerId
        );
      }

      try {
        const raw = await selected.adapter.execute(request.input, settlement.payment);
        let output;
        try {
          output = selected.adapter.normalize(raw);
        } catch (normError) {
          if (normError instanceof ProviderResponseError) throw normError;
          throw new ProviderResponseError(normError instanceof Error ? normError.message : undefined, executionId);
        }
        this.metrics.get(winner.providerId)!.successCount++;
        const result: ArbiterExecutionResult = {
          executionId,
          output,
          decision: {
            providerId: winner.providerId,
            priceUsdc: formatUsdc(winner.priceAtomic),
            qualityScore: winner.qualityScore,
            successRate: winner.successRate,
            economicCost: winner.economicCost,
          },
          payment: {
            network: "stellar:testnet",
            asset: "USDC",
            transactionHash: settlement.receipt.transactionHash,
          },
          mandate: {
            remainingUsdc: formatUsdc(settlement.remainingAtomic),
          },
        };
        this.executions.set(executionId, { status: "complete", result });
        return result;
      } catch (cause) {
        this.metrics.get(winner.providerId)!.failureCount++;
        if (cause instanceof ProviderResponseError) throw cause;
        throw new ProviderExecutionError(cause instanceof Error ? cause.message : undefined, executionId);
      }
    } catch (error) {
      if (this.executions.get(executionId)?.status !== "settlement_unknown") {
        this.executions.set(executionId, { status: "failed" });
      }
      throw error;
    }
  }
}

function isLocalHostname(hostname: string): boolean {
  let host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;

  if (host.startsWith("::ffff:")) {
    const rest = host.slice(7);
    if (rest.includes(".")) {
      host = rest;
    } else if (rest.includes(":")) {
      const hexParts = rest.split(":");
      if (hexParts.length === 2) {
        const high = parseInt(hexParts[0], 16);
        const low = parseInt(hexParts[1], 16);
        if (!isNaN(high) && !isNaN(low)) {
          host = `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
        }
      }
    }
  }

  if (
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe8") ||
    host.startsWith("fe9") ||
    host.startsWith("fea") ||
    host.startsWith("feb")
  ) {
    return true;
  }

  const parts = host.split(".").map(Number);
  if (parts.length === 4 && !parts.some(Number.isNaN)) {
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
  }
  return false;
}
