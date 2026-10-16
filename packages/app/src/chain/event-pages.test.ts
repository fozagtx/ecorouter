import { describe, expect, it, vi } from "vitest";
import { collectEventPages, type EventPageRequest } from "./event-pages";

describe("collectEventPages", () => {
  it("follows advancing cursors through empty pages and collects later events", async () => {
    const calls: EventPageRequest[] = [];
    const pages = [
      { events: [], cursor: "A", latestLedger: 100 },
      { events: [], cursor: "B", latestLedger: 100 },
      { events: [{ id: 1 }, { id: 2 }], cursor: "C", latestLedger: 100 },
      { events: [], cursor: "100", latestLedger: 100 },
    ];
    const getEvents = vi.fn(async (request: EventPageRequest) => {
      calls.push(request);
      return pages.shift()!;
    });

    const events = await collectEventPages(getEvents, {
      startLedger: 1,
      filters: [{ type: "contract", contractIds: ["contract"] }],
      limit: 200,
    });

    expect(events).toEqual([{ id: 1 }, { id: 2 }]);
    expect(calls).toHaveLength(4);
    expect(calls[0]).toMatchObject({ startLedger: 1, limit: 200 });
    expect(calls[1]).toMatchObject({ cursor: "A", limit: 200 });
    expect(calls[2]).toMatchObject({ cursor: "B", limit: 200 });
    expect(calls[3]).toMatchObject({ cursor: "C", limit: 200 });
    expect(calls.slice(1).every((call) => !("startLedger" in call))).toBe(true);
  });
});
