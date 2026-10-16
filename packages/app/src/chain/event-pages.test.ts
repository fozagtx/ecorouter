import { describe, expect, it, vi } from "vitest";
import { collectEventPages, type EventPageRequest } from "./event-pages";

function toid(ledger: number): string {
  return `${String(BigInt(ledger) << 32n).padStart(19, "0")}-4294967295`;
}

describe("collectEventPages", () => {
  it("follows advancing cursors through empty pages and collects later events", async () => {
    const calls: EventPageRequest[] = [];
    const pages = [
      { events: [], cursor: toid(10), latestLedger: 100 },
      { events: [], cursor: toid(11), latestLedger: 100 },
      { events: [{ id: 1 }, { id: 2 }], cursor: toid(12), latestLedger: 100 },
      { events: [], cursor: toid(100), latestLedger: 100 },
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
    expect(calls[1]).toMatchObject({ cursor: toid(10), limit: 200 });
    expect(calls[2]).toMatchObject({ cursor: toid(11), limit: 200 });
    expect(calls[3]).toMatchObject({ cursor: toid(12), limit: 200 });
    expect(calls.slice(1).every((call) => !("startLedger" in call))).toBe(true);
  });

  it("stops on an empty page at or beyond latestLedger without a cursor stall", async () => {
    const calls: EventPageRequest[] = [];
    const getEvents = vi.fn(async (request: EventPageRequest) => {
      calls.push(request);
      return { events: [], cursor: toid(101), latestLedger: 100 };
    });

    const events = await collectEventPages(getEvents, {
      startLedger: 1,
      filters: [{ type: "contract", contractIds: ["contract"] }],
      limit: 200,
    });

    expect(events).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ startLedger: 1 });
  });

  it("retries the first request at the RPC's oldest available ledger", async () => {
    const calls: EventPageRequest[] = [];
    const warn = vi.fn();
    const getEvents = vi.fn(async (request: EventPageRequest) => {
      calls.push(request);
      if (calls.length === 1) throw new Error("startLedger must be within the ledger range: 500 - 800");
      return { events: [], cursor: toid(800), latestLedger: 800 };
    });

    const events = await collectEventPages(
      getEvents,
      {
        startLedger: 1,
        filters: [{ type: "contract", contractIds: ["contract"] }],
        limit: 200,
      },
      warn,
    );

    expect(events).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ startLedger: 1 });
    expect(calls[1]).toMatchObject({ startLedger: 500 });
    expect(warn).not.toHaveBeenCalled();
  });
});
