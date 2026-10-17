import { useEffect, useState } from "react";
import { fmt, parseAmount, toDecimal } from "../lib/money";
import { isValidStrKey } from "../lib/strkey";
import { validatePolicy } from "../engine/validation";
import type { PolicyInput, Spender, SpenderKind } from "../engine/types";
import { useApp } from "../state";
import { PageHead } from "../ui/Shell";
import { AllowanceLine, Avatar, KindBadge, SpenderStatus, periodLabel, serviceName } from "../ui/domain";
import { Addr, Badge, Button, Card, Empty, Field, Icon, Meter, Modal, ago, dateLabel, short } from "../ui/kit";

const PERIODS = [
  { label: "Day", secs: 86_400 },
  { label: "Week", secs: 7 * 86_400 },
  { label: "Month (30 days)", secs: 30 * 86_400 },
];

interface InitialPolicy {
  address?: string;
  label?: string;
  kind?: SpenderKind;
  service?: string;
}

interface FormState {
  name: string;
  address: string;
  kind: SpenderKind;
  allowance: string;
  period: number;
  maxPayment: string;
  maxPayments: string;
  days: string;
  services: string[];
  extra: string;
}

function toForm(spender: Spender | null, displayName: string, now: number, initial?: InitialPolicy | null): FormState {
  if (!spender) {
    return {
      name: initial?.label ?? "",
      address: initial?.address ?? "",
      kind: initial?.kind ?? "person",
      allowance: "1000",
      period: 30 * 86_400,
      maxPayment: "250",
      maxPayments: "20",
      days: "90",
      services: initial?.service ? [initial.service] : [],
      extra: "",
    };
  }
  return {
    name: displayName,
    address: spender.address,
    kind: spender.policy.kind,
    allowance: toDecimal(spender.policy.allowance),
    period: spender.policy.period,
    maxPayment: toDecimal(spender.policy.maxPayment),
    maxPayments: String(spender.policy.maxPayments),
    days: String(Math.max(1, Math.ceil((spender.policy.expiresAt - now) / 86_400))),
    services: spender.policy.services,
    extra: "",
  };
}

function PolicyForm({ editing, initial, onDone }: { editing: Spender | null; initial?: InitialPolicy | null; onDone: () => void }) {
  const { snap, run, name } = useApp();
  const [form, setForm] = useState(() => toForm(editing, editing ? name(editing.address) : "", snap?.now ?? 0, initial));
  const [openedAt, setOpenedAt] = useState(() => snap?.now ?? 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const now = snap?.now ?? 0;
    setOpenedAt(now);
    setForm(toForm(editing, editing ? name(editing.address) : "", now, initial));
  }, [editing, initial?.address, initial?.label, initial?.kind, initial?.service]);
  if (!snap) return null;

  const allowance = parseAmount(form.allowance);
  const maxPayment = parseAmount(form.maxPayment);
  const maxPayments = Number(form.maxPayments);
  const expiresAt = openedAt + Math.round(Number(form.days) * 86_400);
  const services = [...form.services, ...form.extra.split(/[\s,]+/).map((value) => value.trim().toLowerCase()).filter(Boolean)].filter((value, index, all) => all.indexOf(value) === index);
  const address = editing?.address ?? form.address.trim();
  const addressOk = !!editing || isValidStrKey("account", address) || isValidStrKey("contract", address);
  const valid = allowance !== null && maxPayment !== null && Number.isInteger(maxPayments) && addressOk &&
    form.name.trim().length > 0 && validatePolicy({ allowance, maxPayment, period: form.period, maxPayments, expiresAt, services }, snap.now);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || allowance === null || maxPayment === null || busy) return;
    const input: PolicyInput = {
      kind: form.kind,
      label: form.name.trim().slice(0, 32),
      allowance,
      period: form.period,
      maxPayment,
      maxPayments,
      expiresAt,
      services,
    };
    setBusy(true);
    const ok = await run((backend) => backend.setPolicy(address, input, form.name.trim()).then(() => true), editing ? "Policy updated" : `${form.name.trim()} can now spend`);
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Name">
          <input className="input" value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="A name people recognize" />
        </Field>
        <Field label="Kind">
          <select className="input" value={form.kind} disabled={!!editing} onChange={(event) => set("kind", event.target.value as SpenderKind)}>
            <option value="person">Person</option>
            <option value="agent">AI agent</option>
          </select>
        </Field>
      </div>
      {!editing && <Field label="Stellar address" hint="The spender's own account. Only its signature can spend under this policy.">
        <input className="input font-mono text-[12.5px]" value={form.address} onChange={(event) => set("address", event.target.value)} placeholder="G…" />
      </Field>}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Allowance (USDC)">
          <input className="input tnum" inputMode="decimal" value={form.allowance} onChange={(event) => set("allowance", event.target.value)} />
        </Field>
        <Field label="Per">
          <select className="input" value={form.period} onChange={(event) => set("period", Number(event.target.value))}>
            {PERIODS.map((period) => <option key={period.secs} value={period.secs}>{period.label}</option>)}
          </select>
        </Field>
        <Field label="Cap per payment">
          <input className="input tnum" inputMode="decimal" value={form.maxPayment} onChange={(event) => set("maxPayment", event.target.value)} />
        </Field>
        <Field label="Payments per period">
          <input className="input tnum" inputMode="numeric" value={form.maxPayments} onChange={(event) => set("maxPayments", event.target.value)} />
        </Field>
        <Field label="Policy lasts (days)">
          <input className="input tnum" inputMode="numeric" value={form.days} onChange={(event) => set("days", event.target.value)} />
        </Field>
        <div className="flex items-end pb-2 text-[12px] text-ink-muted">Ends {Number(form.days) > 0 ? dateLabel(expiresAt) : "—"}</div>
      </div>
      <div>
        <span className="label">Approved services</span>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {snap.services.map((service) => (
            <label key={service.id} className="flex items-center gap-2 h-9 px-2.5 rounded border border-line hover:border-line-strong text-[13px] cursor-pointer">
              <input type="checkbox" checked={form.services.includes(service.id)} onChange={(event) => set("services", event.target.checked ? [...form.services, service.id] : form.services.filter((id) => id !== service.id))} />
              <span className="flex-1 truncate">{service.name}</span>
              {service.suspended && <Badge tone="bad">Suspended</Badge>}
            </label>
          ))}
        </div>
        <input className="input mt-2 font-mono text-[12.5px]" placeholder="Other service ids, comma separated" value={form.extra} onChange={(event) => set("extra", event.target.value)} />
      </div>
      {!valid && <p className="text-[12px] text-held">Every limit must be above zero, the cap no larger than the allowance, at most 32 services, a valid address and a name.</p>}
      <div className="flex justify-end gap-2 pt-2 border-t border-line">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!valid || busy}>{busy ? "Saving…" : editing ? "Save policy" : "Add spender"}</Button>
      </div>
      <p className="text-[11.5px] text-ink-muted">Saving overwrites every limit at once. Usage so far this period is kept.</p>
    </form>
  );
}

export function Spenders() {
  const { snap, isOwner, run, name, go } = useApp();
  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const queryInitial: InitialPolicy | null = params.has("service") || params.has("kind")
    ? { kind: params.get("kind") === "agent" ? "agent" : "person", ...(params.get("service") ? { service: params.get("service")! } : {}) }
    : null;
  const [editing, setEditing] = useState<Spender | null | "new">(() => queryInitial ? "new" : null);
  const [initial, setInitial] = useState<InitialPolicy | null>(() => queryInitial);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!snap) return null;

  const closePolicy = () => {
    setEditing(null);
    setInitial(null);
    if (window.location.hash.includes("?")) go("/spenders");
  };
  const inviteUrl = `${window.location.origin}${import.meta.env.BASE_URL}#/join?account=${encodeURIComponent(snap.account.id)}`;

  return (
    <>
      <PageHead
        title="Spenders"
        sub="Set clear limits for the people and agents that can spend from this account."
        action={isOwner ? <div className="flex gap-2"><Button onClick={() => setInviteOpen(true)}>Invite</Button><Button variant="primary" onClick={() => { setInitial(null); setEditing("new"); }}><Icon name="plus" /> Add spender</Button></div> : undefined}
      />
      {isOwner && snap.joinRequests.length > 0 && (
        <Card className="mb-5">
          <div className="mb-4"><h2 className="text-[16px] font-semibold">Waiting to join</h2><p className="mt-1 text-[12.5px] text-ink-muted">{snap.joinRequests.length} {snap.joinRequests.length === 1 ? "request" : "requests"}</p></div>
          <div className="divide-y divide-line">
            {snap.joinRequests.map((request) => (
              <div key={request.who} className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 first:pt-0 last:pb-0">
                <Avatar name={request.label || request.who} kind="person" size={36} />
                <div className="min-w-0 flex-1"><div className="font-medium text-[13.5px]">{request.label || "Unnamed spender"}</div><div className="font-mono text-[11.5px] text-ink-muted">{short(request.who, 8)} <span className="font-sans">· asked {ago(request.at, snap.now)}</span></div></div>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => { setInitial({ address: request.who, label: request.label, kind: "person" }); setEditing("new"); }}>Set limits</Button>
                  <Button size="sm" onClick={() => void run((backend) => backend.dismissJoin(request.who), "Join request dismissed")}>Dismiss</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {snap.spenders.length === 0 ? (
        <Card><Empty title="No spenders yet">Add a person or agent and set its limits before it can pay.</Empty>{isOwner && <div className="flex justify-center -mt-4 pb-2"><Button variant="primary" onClick={() => { setInitial(null); setEditing("new"); }}>Add spender</Button></div>}</Card>
      ) : (
        <>
          <div className="hidden md:block panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-[1120px] w-full text-left text-[12.5px]">
                <thead className="bg-surface-soft text-[11px] uppercase tracking-wide text-ink-muted"><tr>{["Name", "Address", "Allowance", "Per-payment cap", "Payments", "Services", "Status", ""].map((label, index) => <th key={`${label}-${index}`} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {snap.spenders.map((spender) => (
                    <tr key={spender.address} className="align-top">
                      <td className="px-4 py-4"><div className="flex items-center gap-2.5"><Avatar name={name(spender.address)} kind={spender.policy.kind} size={32} /><div><div className="font-semibold">{name(spender.address)}</div><div className="mt-0.5"><KindBadge kind={spender.policy.kind} /></div></div></div></td>
                      <td className="px-4 py-4 font-mono text-[11px]"><Addr value={spender.address} /></td>
                      <td className="px-4 py-4"><div className="font-medium tnum">{fmt(spender.usage.spent)} / {fmt(spender.policy.allowance)}</div><Meter value={spender.usage.spent} max={spender.policy.allowance} className="mt-1.5" /><div className="mt-1 text-[11px] text-ink-muted">per {periodLabel(spender.policy.period)}</div></td>
                      <td className="px-4 py-4 font-medium tnum">{fmt(spender.policy.maxPayment)}</td>
                      <td className="px-4 py-4 tnum">{spender.usage.count} / {spender.policy.maxPayments}</td>
                      <td className="px-4 py-4"><div className="flex max-w-[180px] flex-wrap gap-1">{spender.policy.services.slice(0, 2).map((id) => <Badge key={id}>{serviceName(snap, id)}</Badge>)}{spender.policy.services.length > 2 && <Badge>+{spender.policy.services.length - 2}</Badge>}{spender.policy.services.length === 0 && <span className="text-ink-muted">None</span>}</div></td>
                      <td className="px-4 py-4"><SpenderStatus s={spender} now={snap.now} /></td>
                      <td className="px-4 py-4">{isOwner && <details className="relative"><summary className="list-none cursor-pointer rounded-full px-2 py-1 text-[20px] leading-none hover:bg-surface-muted" aria-label={`Actions for ${name(spender.address)}`}>···</summary><div className="absolute right-0 z-10 mt-1 w-36 rounded-lg border border-line bg-white p-1 shadow-card">
                        <button className="block w-full rounded px-3 py-2 text-left hover:bg-surface-soft" onClick={() => { setInitial(null); setEditing(spender); }}>Edit</button>
                        <button className="block w-full rounded px-3 py-2 text-left hover:bg-surface-soft" onClick={() => void run((backend) => backend.setSpenderPaused(spender.address, !spender.policy.paused), spender.policy.paused ? "Spender resumed" : "Spender paused")}>{spender.policy.paused ? "Resume" : "Pause"}</button>
                        <button className="block w-full rounded px-3 py-2 text-left text-destructive hover:bg-surface-soft" onClick={() => { if (confirm(`Remove ${name(spender.address)}? New payments will be refused.`)) void run((backend) => backend.removeSpender(spender.address), "Spender removed"); }}>Remove</button>
                      </div></details>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid md:hidden gap-3">
            {snap.spenders.map((spender) => (
              <Card key={spender.address} className="p-4">
                <div className="flex items-start gap-3"><Avatar name={name(spender.address)} kind={spender.policy.kind} size={36} /><div className="min-w-0 flex-1"><div className="font-semibold">{name(spender.address)}</div><div className="mt-1 flex gap-2"><KindBadge kind={spender.policy.kind} /><SpenderStatus s={spender} now={snap.now} /></div><div className="mt-2 font-mono text-[11px]"><Addr value={spender.address} /></div></div></div>
                <div className="mt-4"><AllowanceLine s={spender} /></div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]"><div><div className="eyebrow mb-1">Per-payment cap</div><b className="tnum">{fmt(spender.policy.maxPayment)}</b></div><div><div className="eyebrow mb-1">Payments</div><b className="tnum">{spender.usage.count} / {spender.policy.maxPayments}</b></div></div>
                <div className="mt-3 flex flex-wrap gap-1">{spender.policy.services.slice(0, 2).map((id) => <Badge key={id}>{serviceName(snap, id)}</Badge>)}{spender.policy.services.length > 2 && <Badge>+{spender.policy.services.length - 2}</Badge>}</div>
                {isOwner && <div className="mt-4 flex gap-2 border-t border-line pt-3"><Button size="sm" onClick={() => { setInitial(null); setEditing(spender); }}>Edit</Button><Button size="sm" onClick={() => void run((backend) => backend.setSpenderPaused(spender.address, !spender.policy.paused), spender.policy.paused ? "Spender resumed" : "Spender paused")}>{spender.policy.paused ? "Resume" : "Pause"}</Button><Button size="sm" variant="danger" onClick={() => { if (confirm(`Remove ${name(spender.address)}? New payments will be refused.`)) void run((backend) => backend.removeSpender(spender.address), "Spender removed"); }}>Remove</Button></div>}
              </Card>
            ))}
          </div>
        </>
      )}
      <Modal open={editing !== null} onClose={closePolicy} title={editing === "new" ? "Add a spender" : `Edit ${editing ? name(editing.address) : ""}'s policy`} wide>
        {editing !== null && <PolicyForm editing={editing === "new" ? null : editing} initial={initial} onDone={closePolicy} />}
      </Modal>
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite a spender">
        <p className="text-[13px] text-ink-secondary">Share this link with the person or agent you want to add.</p>
        <div className="mt-3 flex gap-2"><input readOnly className="input min-w-0 flex-1 font-mono text-[11px]" value={inviteUrl} /><Button onClick={async () => { try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { setCopied(false); } }}>{copied ? "Copied" : "Copy"}</Button></div>
        <ol className="mt-5 space-y-3 text-[13px] text-ink-secondary"><li><b className="mr-2 text-ink">1.</b>Open the link and connect Freighter.</li><li><b className="mr-2 text-ink">2.</b>Ask to join the account.</li><li><b className="mr-2 text-ink">3.</b>You set their limits here before they can spend.</li></ol>
      </Modal>
    </>
  );
}
