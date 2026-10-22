import { usd } from "ecorouter";
import type { JobSpec } from "./agent.js";

const LONG_CONTEXT = "Quarterly filings, pricing pages and customer reviews for the company. ".repeat(220);

/**
 * The Kit 12 story: three research reports run at once on a float smaller than their budgets together.
 * Report B's final prompt carries four times the context it was budgeted for.
 */
export function demoJobs(): JobSpec[] {
  const report = (id: string, customer: string, company: string, budget: number, overrun = false): JobSpec => ({
    id,
    customer,
    budget: usd(budget),
    latencyTargetMs: 6_000,
    steps: [
      { id: "plan", kind: "reasoning", prompt: `Plan a research report on ${company}.`, maxTokens: 400 },
      { id: "search", kind: "search", prompt: `${company} pricing and revenue 2026` },
      { id: "lookup", kind: "lookup", prompt: `${company} company profile` },
      {
        id: "write",
        kind: "reasoning",
        prompt: `Write the report on ${company}. Sources: ${overrun ? LONG_CONTEXT : LONG_CONTEXT.slice(0, LONG_CONTEXT.length / 4)}`,
        maxTokens: 1200,
        important: true,
      },
    ],
  });
  return [
    report("job-a", "Northwind", "Acme Robotics", 0.4),
    report("job-b", "Contoso", "Globex Freight", 0.12, true),
    report("job-c", "Fabrikam", "Initech Health", 0.4),
  ];
}

/** Float below the three budgets together ($0.92): $0.80 free above the floor, so jobs compete for it. */
export const DEMO_FLOAT = usd(0.9);
export const DEMO_FLOOR = usd(0.1);
