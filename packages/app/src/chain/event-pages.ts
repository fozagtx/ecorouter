export type EventPageRequest = {
  filters: Array<{ type: "contract"; contractIds: string[] }>;
  limit: number;
} & ({ startLedger: number; cursor?: never } | { cursor: string; startLedger?: never });

export type EventPage<T> = {
  events: T[];
  cursor: string;
  latestLedger: number;
};

function cursorLedger(cursor: string): number | null {
  const match = /^(\d+)(?:[-:]|$)/.exec(cursor);
  if (!match) return null;
  return Number(BigInt(match[1]) >> 32n);
}

export async function collectEventPages<T>(
  getEvents: (request: EventPageRequest) => Promise<EventPage<T>>,
  firstRequest: Extract<EventPageRequest, { startLedger: number }>,
  warn: (error: unknown) => void = (error) => console.warn("Failed to load contract events", error),
): Promise<T[]> {
  const events: T[] = [];
  let request: EventPageRequest = firstRequest;
  let fetchedPages = 0;
  let retriedRange = false;

  while (fetchedPages < 40) {
    let response: EventPage<T>;
    try {
      response = await getEvents(request);
    } catch (error) {
      if (fetchedPages === 0 && !retriedRange && "startLedger" in request) {
        const message = error instanceof Error ? error.message : String(error);
        const range = /ledger range:\s*(\d+)\s*-\s*(\d+)/i.exec(message);
        if (range) {
          request = { startLedger: Number(range[1]), filters: request.filters, limit: request.limit };
          retriedRange = true;
          continue;
        }
      }
      warn(error);
      break;
    }

    fetchedPages++;
    events.push(...response.events);
    const requestedCursor = "cursor" in request ? request.cursor : undefined;
    const cursorStalled = requestedCursor !== undefined && response.cursor === requestedCursor;
    const cursorAtLatest = (cursorLedger(response.cursor) ?? 0) >= response.latestLedger;
    if (cursorStalled || (response.events.length === 0 && cursorAtLatest)) break;

    request = {
      cursor: response.cursor,
      filters: firstRequest.filters,
      limit: firstRequest.limit,
    };
  }

  return events;
}
