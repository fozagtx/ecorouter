import { useEffect, useState } from "react";
import { fmt, parseAmount } from "../lib/money";
import { listingValidationError } from "../engine/marketplace";
import type { Service } from "../engine/types";
import { configFromEnv } from "../chain/config";
import { useApp } from "../state";
import { PageHead } from "../ui/Shell";
import { Badge, Button, Card, Empty, Field, Icon, Modal, cx, short } from "../ui/kit";

interface Draft {
  id: string;
  name: string;
  kind: "api" | "mcp";
  task: string;
  price: string;
}

const INITIAL_DRAFT: Draft = { id: "", name: "", kind: "api", task: "", price: "" };

function accountExplorer(address: string): string {
  return `https://stellar.expert/explorer/testnet/account/${address}`;
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

function KindBadge({ kind }: { kind: Service["kind"] }) {
  return <Badge tone={kind === "mcp" ? "accent" : "neutral"}>{kind.toUpperCase()}</Badge>;
}

function ListingDetails({
  listing,
  gatewayUrl,
  isOwner,
  onClose,
  onAllow,
}: {
  listing: Service | null;
  gatewayUrl: string | null;
  isOwner: boolean;
  onClose: () => void;
  onAllow: (id: string) => void;
}) {
  if (!listing) return null;
  const url = gatewayUrl ? `${gatewayUrl.replace(/\/$/, "")}/a/${listing.id}` : "";
  const snippet = listing.kind === "mcp"
    ? `const agent = new TeamAgent({ secret: process.env.AGENT_SECRET });\nconst result = await agent.mcpCall("${url || "<gateway url unavailable>"}", "tool_name", {});`
    : `const agent = new TeamAgent({ secret: process.env.AGENT_SECRET });\nconst { response } = await agent.fetch("${url || "<gateway url unavailable>"}");`;

  return (
    <Modal open={!!listing} onClose={onClose} title={listing.name} wide>
      <div className="flex items-center gap-2">
        <KindBadge kind={listing.kind} />
        {listing.suspended
          ? <Badge tone="bad">Suspended</Badge>
          : <Badge tone="ok">Listed on chain</Badge>}
      </div>
      <p className="mt-4 text-[14px] leading-relaxed text-ink-secondary">{listing.task}</p>
      <div className="mt-5 grid sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-line p-3">
          <div className="eyebrow">Price</div>
          <div className="mt-1 font-semibold tnum">{fmt(listing.price)} USDC / call</div>
        </div>
        <div className="rounded-lg border border-line p-3">
          <div className="eyebrow">Listing id</div>
          <div className="mt-1 font-mono">{listing.id}</div>
        </div>
      </div>
      <div className="mt-5">
        <div className="label">x402 URL</div>
        {url ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-muted p-3 text-[12px]">{url}</code>
            <CopyButton value={url} />
          </div>
        ) : (
          <p className="rounded-lg bg-surface-muted p-3 text-[13px] text-ink-secondary">Gateway not deployed yet. This listing has no callable x402 URL.</p>
        )}
      </div>
      <dl className="mt-5 grid sm:grid-cols-2 gap-4 text-[13px]">
        <div>
          <dt className="eyebrow mb-1">Seller</dt>
          <dd><a href={accountExplorer(listing.seller)} target="_blank" rel="noreferrer" title={listing.seller} className="inline-flex items-center gap-1 hover:underline"><span className="font-mono">{short(listing.seller, 8)}</span><Icon name="external" className="w-3 h-3" /></a></dd>
        </div>
        <div>
          <dt className="eyebrow mb-1">Payee</dt>
          <dd><a href={accountExplorer(listing.payee)} target="_blank" rel="noreferrer" title={listing.payee} className="inline-flex items-center gap-1 hover:underline"><span className="font-mono">{short(listing.payee, 8)}</span><Icon name="external" className="w-3 h-3" /></a></dd>
        </div>
      </dl>
      <div className="mt-5">
        <div className="label">Call it from an agent</div>
        <pre className="overflow-x-auto whitespace-pre rounded-lg bg-[#F7F7F4] p-3 text-[12px] leading-6 text-ink-secondary">{snippet}</pre>
      </div>
      {isOwner && (
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={() => onAllow(listing.id)}>Allow for a spender</Button>
        </div>
      )}
    </Modal>
  );
}

function ListAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { backend, snap, refresh, toast } = useApp();
  const gatewayUrl = configFromEnv().gatewayUrl;
  const [draft, setDraft] = useState<Draft>(INITIAL_DRAFT);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [endpoint, setEndpoint] = useState("");
  const [authHeader, setAuthHeader] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const price = parseAmount(draft.price);
  const validationError = listingValidationError({ ...draft, price });
  const showValidationError = !!(draft.id || draft.name || draft.task || draft.price);
  const taskBytes = new TextEncoder().encode(draft.task).length;

  const close = () => {
    onClose();
    setDraft(INITIAL_DRAFT);
    setStep(1);
    setEndpoint("");
    setAuthHeader("");
    setBusy(false);
    setError("");
  };

  const register = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!backend || !price || validationError || busy) return;
    setBusy(true);
    setError("");
    try {
      await backend.registerListing({ id: draft.id, name: draft.name.trim(), kind: draft.kind, task: draft.task.trim(), price });
      toast({ tone: "ok", title: "Listing added to the registry" });
      await refresh();
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    if (!backend || !gatewayUrl || !endpoint.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await backend.connectUpstream(draft.id, {
        url: endpoint.trim(),
        kind: draft.kind,
        ...(authHeader ? { authHeader } : {}),
      });
      toast({ tone: "ok", title: "Endpoint connected" });
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const url = gatewayUrl ? `${gatewayUrl.replace(/\/$/, "")}/a/${draft.id}` : "";

  return (
    <Modal open={open} onClose={close} title="List your agent" wide>
      <div className="mb-6 flex items-center gap-3 text-[12px]">
        {[1, 2].map((n) => (
          <div key={n} className={cx("flex items-center gap-2", step >= n ? "text-ink" : "text-ink-muted")}>
            <span className={cx("inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-medium", step >= n ? "border-ink bg-ink text-white" : "border-line")}>{n}</span>
            <span>{n === 1 ? "On-chain listing" : "Connect endpoint"}</span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <form className="space-y-4" onSubmit={(event) => void register(event)}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Listing id" hint="1–9 lowercase letters, numbers, or underscores.">
              <input className="input font-mono" maxLength={9} value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value.toLowerCase() })} placeholder="my_agent" />
            </Field>
            <Field label="Name">
              <input className="input" maxLength={64} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="A short name" />
            </Field>
          </div>
          <Field label="Type">
            <div className="grid grid-cols-2 gap-2">
              {(["api", "mcp"] as const).map((kind) => (
                <button key={kind} type="button" aria-pressed={draft.kind === kind} onClick={() => setDraft({ ...draft, kind })} className={cx("h-10 rounded-full border text-[13px] font-medium transition-colors", draft.kind === kind ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-secondary hover:border-line-strong")}>
                  {kind === "api" ? "API" : "MCP"}
                </button>
              ))}
            </div>
          </Field>
          <Field label="What does it do?">
            <textarea className="input h-28 resize-y py-2.5" maxLength={280} value={draft.task} onChange={(event) => setDraft({ ...draft, task: event.target.value })} placeholder="Describe the task this agent handles." />
            <span className={cx("mt-1 block text-right text-[11.5px]", taskBytes > 280 ? "text-destructive" : "text-ink-muted")}>{taskBytes} / 280 bytes</span>
          </Field>
          <Field label="Price per call (USDC)">
            <input className="input tnum" inputMode="decimal" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} placeholder="0.01" />
          </Field>
          <div className="rounded-lg border border-line bg-surface-soft p-3">
            <div className="label mb-1">Payee</div>
            <input className="input font-mono text-[12px]" readOnly value={snap?.me ?? ""} />
            <p className="mt-1 text-[12px] text-ink-muted">Payments go straight to this address.</p>
          </div>
          {(error || (showValidationError && validationError)) && <p className="text-[12.5px] text-destructive">{error || validationError}</p>}
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!!validationError || busy}>{busy ? "Signing…" : "Add listing"}</Button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-[14px] text-ink-secondary">The listing is on chain. Connect the private endpoint to the gateway to accept calls.</p>
          {gatewayUrl ? (
            <>
              <Field label="Endpoint URL">
                <input className="input font-mono text-[12px]" type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://api.example.com" />
              </Field>
              <Field label="Authorization header (optional)" hint="Stored privately in the gateway, never on-chain.">
                <input className="input font-mono text-[12px]" type="password" autoComplete="new-password" value={authHeader} onChange={(event) => setAuthHeader(event.target.value)} placeholder="Bearer …" />
              </Field>
              <p className="text-[12px] text-ink-muted">Freighter will ask you to sign a short message to prove you control the seller address.</p>
              {error && <p className="text-[12.5px] text-destructive">{error}</p>}
              <div className="flex justify-end gap-2 border-t border-line pt-4">
                <Button variant="ghost" onClick={close}>Connect later</Button>
                <Button variant="primary" disabled={!endpoint.trim() || busy} onClick={() => void connect()}>{busy ? "Signing and connecting…" : "Sign and connect"}</Button>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-line bg-surface-muted p-4">
              <div className="font-medium">Gateway not deployed yet</div>
              <p className="mt-1 text-[13px] text-ink-secondary">Your listing is on chain, but there is no gateway URL to connect this endpoint or accept x402 calls.</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" onClick={close}>Done</Button>
                <Button variant="primary" disabled title="Gateway not deployed yet">Sign and connect</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="font-medium">Your endpoint is connected.</div>
          <p className="mt-1 text-[13px] text-ink-secondary">The upstream URL and authorization header stay private in the gateway.</p>
          <div className="mt-5 label">x402 URL</div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-muted p-3 text-[12px]">{url}</code>
            <CopyButton value={url} />
          </div>
          <div className="mt-5 flex justify-end border-t border-line pt-4">
            <Button variant="primary" onClick={close}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function Marketplace() {
  const { snap, backend, isOwner, go } = useApp();
  const gatewayUrl = configFromEnv().gatewayUrl;
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [gatewayError, setGatewayError] = useState("");
  const [checking, setChecking] = useState(false);
  const [listingOpen, setListingOpen] = useState(false);
  const [selected, setSelected] = useState<Service | null>(null);

  useEffect(() => {
    if (!backend || !gatewayUrl) {
      setConnected({});
      setGatewayError("");
      return;
    }
    let active = true;
    setChecking(true);
    void backend.gatewayListings().then((listings) => {
      if (!active) return;
      setConnected(Object.fromEntries(listings.map((item) => [item.id, item.connected])));
      setGatewayError("");
    }).catch((error: unknown) => {
      if (!active) return;
      setGatewayError(error instanceof Error ? error.message : String(error));
      setConnected({});
    }).finally(() => {
      if (active) setChecking(false);
    });
    return () => { active = false; };
  }, [backend, gatewayUrl, snap?.services]);

  if (!snap) return null;
  const live = snap.services;

  return (
    <>
      <PageHead
        title="Marketplace"
        sub="AI agents and APIs your agents can pay per call over x402."
        action={<Button variant="primary" onClick={() => setListingOpen(true)}>List your agent</Button>}
      />
      {!gatewayUrl ? (
        <div className="mb-5 rounded-lg border border-line bg-surface-soft px-4 py-3 text-[13px] text-ink-secondary">Gateway not deployed yet. Listings can be read from the chain, but they cannot accept paid calls.</div>
      ) : gatewayError ? (
        <div className="mb-5 rounded-lg border border-held-line bg-held-soft px-4 py-3 text-[13px] text-held">Could not read gateway connection status: {gatewayError}</div>
      ) : null}
      {live.length > 0 ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {live.map((listing) => {
            const status = listing.suspended ? "suspended" : !gatewayUrl ? "disconnected" : connected[listing.id] === true ? "live" : gatewayError || checking || connected[listing.id] === undefined ? "unknown" : "disconnected";
            return (
              <button key={listing.id} type="button" onClick={() => setSelected(listing)} className="panel p-5 sm:p-6 text-left transition-shadow hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 text-[18px] font-semibold tracking-[-0.025em] truncate">{listing.name}</h2>
                  <KindBadge kind={listing.kind} />
                </div>
                <p className="mt-3 min-h-[3.9rem] text-[13.5px] leading-5 text-ink-secondary line-clamp-3">{listing.task}</p>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <div className="text-[14px] font-semibold tnum">{fmt(listing.price)} <span className="font-normal text-ink-muted">USDC / call</span></div>
                  <Badge tone={status === "live" ? "ok" : status === "suspended" ? "bad" : "neutral"}>
                    {status === "live" ? "Live" : status === "suspended" ? "Suspended" : status === "unknown" ? "Checking" : "Not connected"}
                  </Badge>
                </div>
                <div className="mt-4 border-t border-line pt-3 text-[12px] text-ink-muted">
                  Seller <span className="font-mono text-ink-secondary">{short(listing.seller, 5)}</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <Card>
          <Empty title="No agents listed yet">
            Add an API or MCP listing from the chain, then connect its endpoint to the gateway.
          </Empty>
          <div className="flex justify-center -mt-4 pb-2">
            <Button variant="primary" onClick={() => setListingOpen(true)}>List your agent</Button>
          </div>
        </Card>
      )}
      <ListingDetails
        listing={selected}
        gatewayUrl={gatewayUrl}
        isOwner={isOwner}
        onClose={() => setSelected(null)}
        onAllow={(id) => {
          setSelected(null);
          go(`/spenders?service=${encodeURIComponent(id)}`);
        }}
      />
      <ListAgentModal open={listingOpen} onClose={() => setListingOpen(false)} />
    </>
  );
}
