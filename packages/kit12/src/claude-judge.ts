import { formatUsd } from "ecorouter";
import { ruleJudge, type Judge } from "./agent.js";

/**
 * The model's one decision: is this step worth the premium provider?
 * It answers through a single typed tool. It never sees keys, cannot move money,
 * and code has already checked that both options fit the budget.
 */
export function claudeJudge(opts: { apiKey: string; model?: string; fetch?: typeof fetch }): Judge {
  const model = opts.model ?? "claude-haiku-5-5";
  return {
    async worthPremium(input) {
      const { job, step, cheapest, premium, budgetLeft } = input;
      try {
        const res = await (opts.fetch ?? fetch)("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model,
            max_tokens: 200,
            tool_choice: { type: "tool", name: "choose_provider" },
            tools: [
              {
                name: "choose_provider",
                description: "Choose whether this research step should use the premium provider or the cheapest one.",
                input_schema: {
                  type: "object",
                  properties: {
                    premium: { type: "boolean", description: "true to use the premium provider" },
                    why: { type: "string", description: "one short sentence a customer could read" },
                  },
                  required: ["premium", "why"],
                },
              },
            ],
            messages: [
              {
                role: "user",
                content:
                  `A research report for ${job.customer} has a step "${step.id}" (${step.kind}${step.important ? ", the customer reads this output directly" : ""}).\n` +
                  `Cheapest provider: ${cheapest.providerId} at ${formatUsd(cheapest.amount)}. Premium provider: ${premium.providerId} at ${formatUsd(premium.amount)}.\n` +
                  `Budget left on the customer's hold: ${formatUsd(budgetLeft)}. Steps after this one still need paying for.\n` +
                  `Is the better answer worth the difference here?`,
              },
            ],
          }),
        });
        if (!res.ok) throw new Error(`judge API ${res.status}`);
        const body = (await res.json()) as { content: Array<{ type: string; name?: string; input?: { premium?: unknown; why?: unknown } }> };
        const call = body.content.find((c) => c.type === "tool_use" && c.name === "choose_provider");
        if (typeof call?.input?.premium !== "boolean") throw new Error("judge returned no decision");
        return { premium: call.input.premium, why: String(call.input.why ?? "") };
      } catch (err) {
        const fallback = await ruleJudge.worthPremium(input);
        return { ...fallback, why: `${fallback.why} (rule used: ${err instanceof Error ? err.message : err})` };
      }
    },
  };
}
