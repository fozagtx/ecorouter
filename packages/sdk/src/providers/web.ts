import { usd } from "../money.js";
import type { CallResult, Provider, StepInput } from "../types.js";
import { postJson, requireKey } from "./http.js";

interface WebOptions {
  apiKey: string | undefined;
  fetch?: typeof fetch;
}

function expect<K extends StepInput["kind"]>(input: StepInput, kind: K): Extract<StepInput, { kind: K }> {
  if (input.kind !== kind) throw new Error(`expected a ${kind} step, got ${input.kind}`);
  return input as Extract<StepInput, { kind: K }>;
}

/** Exa search. Uses the cost Exa reports in `costDollars.total` when present. */
export function exa(opts: WebOptions): Provider {
  return {
    id: "exa",
    name: "Exa",
    kinds: ["search"],
    async call(raw, signal): Promise<CallResult> {
      const input = expect(raw, "search");
      const body = await postJson<{
        results: Array<{ title?: string; url: string; text?: string }>;
        costDollars?: { total?: number };
      }>(
        "Exa",
        "https://api.exa.ai/search",
        { "x-api-key": requireKey("EXA_API_KEY", opts.apiKey) },
        { query: input.query, numResults: input.maxResults ?? 5 },
        signal,
        opts.fetch,
      );
      const results = body.results.map((r) => ({ title: r.title, url: r.url, snippet: r.text?.slice(0, 300) }));
      return {
        output: { text: results.map((r) => `${r.title ?? r.url}\n${r.url}`).join("\n\n"), results, raw: body },
        usage: { reportedCost: typeof body.costDollars?.total === "number" ? usd(body.costDollars.total) : undefined },
      };
    },
  };
}

/** Tavily search. */
export function tavily(opts: WebOptions): Provider {
  return {
    id: "tavily",
    name: "Tavily",
    kinds: ["search"],
    async call(raw, signal): Promise<CallResult> {
      const input = expect(raw, "search");
      const body = await postJson<{ answer?: string; results: Array<{ title?: string; url: string; content?: string }> }>(
        "Tavily",
        "https://api.tavily.com/search",
        { authorization: `Bearer ${requireKey("TAVILY_API_KEY", opts.apiKey)}` },
        { query: input.query, max_results: input.maxResults ?? 5 },
        signal,
        opts.fetch,
      );
      const results = body.results.map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 300) }));
      return {
        output: { text: body.answer ?? results.map((r) => `${r.title ?? r.url}\n${r.url}`).join("\n\n"), results, raw: body },
        usage: {},
      };
    },
  };
}

/** Firecrawl scrape to markdown. Uses `metadata.creditsUsed` when Firecrawl reports it. */
export function firecrawl(opts: WebOptions): Provider {
  return {
    id: "firecrawl",
    name: "Firecrawl",
    kinds: ["scrape"],
    async call(raw, signal): Promise<CallResult> {
      const input = expect(raw, "scrape");
      const body = await postJson<{ success: boolean; data?: { markdown?: string; metadata?: { creditsUsed?: number } } }>(
        "Firecrawl",
        "https://api.firecrawl.dev/v1/scrape",
        { authorization: `Bearer ${requireKey("FIRECRAWL_API_KEY", opts.apiKey)}` },
        { url: input.url, formats: ["markdown"] },
        signal,
        opts.fetch,
      );
      if (!body.success || body.data?.markdown === undefined) throw new Error("Firecrawl returned no markdown");
      const credits = body.data.metadata?.creditsUsed;
      return { output: { text: body.data.markdown, raw: body }, usage: { credits: typeof credits === "number" ? credits : undefined } };
    },
  };
}

/** context.dev web scrape to markdown. Uses `key_metadata.credits_consumed` for the actual cost. */
export function contextDev(opts: WebOptions): Provider {
  return {
    id: "contextdev",
    name: "context.dev",
    kinds: ["scrape"],
    async call(raw, signal): Promise<CallResult> {
      const input = expect(raw, "scrape");
      const body = await postJson<{
        markdown?: { success?: boolean; data?: string };
        key_metadata?: { credits_consumed?: number };
      }>(
        "context.dev",
        "https://api.context.dev/v1/web/scrape",
        { authorization: `Bearer ${requireKey("CONTEXT_DEV_API_KEY", opts.apiKey)}` },
        { url: input.url, formats: { markdown: true }, sharedParams: { mainContentOnly: true } },
        signal,
        opts.fetch,
      );
      if (body.markdown?.data === undefined) throw new Error("context.dev returned no markdown");
      const credits = body.key_metadata?.credits_consumed;
      return { output: { text: body.markdown.data, raw: body }, usage: { credits: typeof credits === "number" ? credits : undefined } };
    },
  };
}
