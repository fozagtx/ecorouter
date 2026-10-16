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
  const ledger = Number(match[1]);
  return Number.isSafeInteger(ledger) ? ledger : null;
}

export async function collectEventPages<T>(
  getEvents: (request: EventPageRequest) => Promise<EventPage<T>>,
  firstRequest: Extract<EventPageRequest, { startLedger: number }>,
  warn: (error: unknown) => void = (error) => console.warn("Failed to load contract events", error),
): Promise<T[]> {
  const events: T[] = [];
  let request: EventPageRequest = firstRequest;

  for (let page = 0; page < 40; page++) {
    let response: EventPage<T>;
    try {
      response = await getEvents(request);
    } catch (error) {
      warn(error);
      break;
    }

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
