import { usd } from "../money.js";
import type { CallResult, Provider, StepInput } from "../types.js";
import { postJson, requireKey } from "./http.js";

interface ModelOptions {
  /** Provider id used for routing and pricing, e.g. "groq:llama-3.3-70b". */
  id: string;
  name: string;
  model: string;
  apiKey: string | undefined;
  frontier?: boolean;
  fetch?: typeof fetch;
}

function reasoningOnly(input: StepInput) {
  if (input.kind !== "reasoning") throw new Error(`model providers only serve reasoning steps, got ${input.kind}`);
  return input;
}

/** Anthropic Messages API. */
export function anthropic(opts: ModelOptions): Provider {
  return {
    id: opts.id,
    name: opts.name,
    kinds: ["reasoning"],
    frontier: opts.frontier,
    async call(raw, signal): Promise<CallResult> {
      const input = reasoningOnly(raw);
      const body = await postJson<{
        content: Array<{ type: string; text?: string }>;
        usage: { input_tokens: number; output_tokens: number };
      }>(
        opts.name,
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": requireKey(`${opts.name} API key`, opts.apiKey), "anthropic-version": "2023-06-01" },
        {
          model: opts.model,
          max_tokens: input.maxOutputTokens ?? 1024,
          ...(input.system ? { system: input.system } : {}),
          messages: [{ role: "user", content: input.prompt }],
        },
        signal,
        opts.fetch,
      );
      return {
        output: { text: body.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""), raw: body },
        usage: { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens },
      };
    },
  };
}

interface ChatCompletion {
  choices: Array<{ message: { content: string | null } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
}

/**
 * Any OpenAI-compatible chat completions API: OpenAI, Groq, Mistral, DeepSeek, Together, Fireworks.
 * Pass the provider's base URL, e.g. "https://api.groq.com/openai/v1".
 */
export function openaiCompatible(opts: ModelOptions & { baseUrl: string }): Provider {
  return {
    id: opts.id,
    name: opts.name,
    kinds: ["reasoning"],
    frontier: opts.frontier,
    async call(raw, signal): Promise<CallResult> {
      const input = reasoningOnly(raw);
      const body = await postJson<ChatCompletion>(
        opts.name,
        `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`,
        { authorization: `Bearer ${requireKey(`${opts.name} API key`, opts.apiKey)}` },
        {
          model: opts.model,
          max_tokens: input.maxOutputTokens ?? 1024,
          messages: [
            ...(input.system ? [{ role: "system", content: input.system }] : []),
            { role: "user", content: input.prompt },
          ],
        },
        signal,
        opts.fetch,
      );
      return {
        output: { text: body.choices[0]?.message.content ?? "", raw: body },
        usage: { inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens },
      };
    },
  };
}

/**
 * OpenRouter: one key, many models, and live per-token prices (see OpenRouterPrices).
 * The id must be "openrouter:<model id>" so the price source can find it.
 */
export function openrouter(opts: Omit<ModelOptions, "id" | "name"> & { name?: string }): Provider {
  const id = `openrouter:${opts.model}`;
  const name = opts.name ?? `OpenRouter ${opts.model}`;
  return {
    id,
    name,
    kinds: ["reasoning"],
    frontier: opts.frontier,
    async call(raw, signal): Promise<CallResult> {
      const input = reasoningOnly(raw);
      const body = await postJson<ChatCompletion>(
        name,
        "https://openrouter.ai/api/v1/chat/completions",
        { authorization: `Bearer ${requireKey("OPENROUTER_API_KEY", opts.apiKey)}` },
        {
          model: opts.model,
          max_tokens: input.maxOutputTokens ?? 1024,
          usage: { include: true },
          messages: [
            ...(input.system ? [{ role: "system", content: input.system }] : []),
            { role: "user", content: input.prompt },
          ],
        },
        signal,
        opts.fetch,
      );
      return {
        output: { text: body.choices[0]?.message.content ?? "", raw: body },
        usage: {
          inputTokens: body.usage?.prompt_tokens,
          outputTokens: body.usage?.completion_tokens,
          reportedCost: typeof body.usage?.cost === "number" ? usd(body.usage.cost) : undefined,
        },
      };
    },
  };
}
