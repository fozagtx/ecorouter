import type { Activity, Service } from "./types";

export function mapRegistryListing(value: unknown): Service {
  const raw = value as Record<string, unknown>;
  const kind = String(raw.kind);
  if (kind !== "api" && kind !== "mcp") throw new Error(`Invalid listing kind: ${kind}`);
  return {
    id: String(raw.id),
    name: String(raw.name),
    seller: String(raw.seller),
    kind,
    task: String(raw.task),
    payee: String(raw.payee),
    url: String(raw.url ?? ""),
    price: BigInt(String(raw.price)),
    suspended: Boolean(raw.suspended),
  };
}

export function isListingIdValid(id: string): boolean {
  return /^[a-z0-9_]{1,9}$/.test(id);
}

export function listingValidationError(input: {
  id: string;
  name: string;
  task: string;
  price: bigint | null;
}): string | null {
  if (!isListingIdValid(input.id)) return "Use 1–9 lowercase letters, numbers, or underscores for the id.";
  if (!input.name.trim()) return "Add a name for the listing.";
  if (!input.task.trim()) return "Describe what the agent does.";
  if (new TextEncoder().encode(input.task).length > 280) return "The task description must be 280 bytes or fewer.";
  if (input.price === null || input.price <= 0n) return "Enter a price greater than zero.";
  return null;
}

export interface SacTransfer {
  id: string;
  txHash: string;
  at: number;
  from: string;
  to: string;
  amount: bigint;
}

export function mapX402Transfers(
  transfers: SacTransfer[],
  accountId: string,
  services: Service[],
  existing: Activity[],
): Activity[] {
  const seenTransactions = new Set(existing.flatMap((event) => event.txHash ? [event.txHash] : []));
  return transfers.flatMap((transfer) => {
    if (transfer.from !== accountId || seenTransactions.has(transfer.txHash)) return [];
    const service = services.find((listing) => listing.payee === transfer.to);
    if (!service) return [];
    seenTransactions.add(transfer.txHash);
    return [{
      id: `x402-${transfer.id}`,
      kind: "paid" as const,
      at: transfer.at,
      service: service.id,
      amount: transfer.amount,
      txHash: transfer.txHash,
      via: "x402" as const,
      note: transfer.to,
    }];
  });
}
