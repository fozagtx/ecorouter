import { useEffect, useState } from "react";
import { fmt, parseAmount, toDecimal } from "../lib/money";
import { isValidStrKey } from "../lib/strkey";
import { validatePolicy } from "../engine/validation";
import type { PolicyInput, Spender, SpenderKind } from "../engine/types";
import { useApp } from "../state";
import { PageHead } from "../ui/Shell";
import { AllowanceLine, Avatar, KindBadge, SpenderStatus, periodLabel, serviceName } from "../ui/domain";
import { Addr, Badge, Button, Card, Field, Icon, Modal, dateLabel } from "../ui/kit";

const PERIODS = [
  { label: "Day", secs: 86_400 },
  { label: "Week", secs: 7 * 86_400 },
  { label: "Month (30 days)", secs: 30 * 86_400 },
];

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

function toForm(s: Spender | null, name: string, now: number): FormState {
  if (!s) return { name: "", address: "", kind: "person", allowance: "1000", period: 30 * 86_400, maxPayment: "250", maxPayments: "20", days: "90", services: [], extra: "" };
  return {
    name,
    address: s.address,
    kind: s.policy.kind,
    allowance: toDecimal(s.policy.allowance),
    period: s.policy.period,
    maxPayment: toDecimal(s.policy.maxPayment),
    maxPayments: String(s.policy.maxPayments),
    days: String(Math.max(1, Math.ceil((s.policy.expiresAt - now) / 86_400))),
    services: s.policy.services,
    extra: "",
  };
}

export function PolicyForm({ editing, onDone }: { editing: Spender | null; onDone: () => void }) {
  const { snap, run, name } = useApp();
  const [f, setF] = useState<FormState>(() => toForm(editing, editing ? name(editing.address) : "", snap?.now ?? 0));
  const [openedAt, setOpenedAt] = useState(() => snap?.now ?? 0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const now = snap?.now ?? 0;
    setOpenedAt(now);
    setF(toForm(editing, editing ? name(editing.address) : "", now));
  }, [editing]);
  if (!snap) return null;

  const allowance = parseAmount(f.allowance);
  const maxPayment = parseAmount(f.maxPayment);
  const maxPayments = Number(f.maxPayments);
  const expiresAt = openedAt + Math.round(Number(f.days) * 86_400);
  const services = [...f.services, ...f.extra.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)].filter((v, i, a) => a.indexOf(v) === i);
  const address = editing?.address ?? f.address.trim();
  const addressOk = !!editing || isValidStrKey("account", address) || isValidStrKey("contract", address);
  const valid =
    allowance !== null &&
    maxPayment !== null &&
    Number.isInteger(maxPayments) &&
    addressOk &&
    f.name.trim().length > 0 &&
    validatePolicy({ allowance, maxPayment, period: f.period, maxPayments, expiresAt, services }, snap.now);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    if (!valid || allowance === null || maxPayment === null) return;
    const input: PolicyInput = { kind: f.kind, label: f.name.trim().slice(0, 32), allowance, period: f.period, maxPayment, maxPayments, expiresAt, services };
    setBusy(true);
    const ok = await run((b) => b.setPolicy(address, input, f.name.trim()).then(() => true), editing ? "Policy updated" : `${f.name.trim()} can now spend`);
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Name">
          <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Marcus, or Research agent" />
        </Field>
        <Field label="Kind" hint={f.kind === "agent" ? "Agents sign with their own key and cannot ask for exceptions." : "People can ask the owner to approve a held payment."}>
          <select className="input" value={f.kind} disabled={!!editing} onChange={(e) => set("kind", e.target.value as SpenderKind)}>
            <option value="person">Person</option>
            <option value="agent">AI agent</option>
          </select>
        </Field>
      </div>
      {!editing && (
        <Field label="Stellar address" hint="The spender's own account (G…). Only its signature can spend under this policy.">
          <input className="input font-mono text-[12.5px]" value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="G…" />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Allowance (USDC)">
          <input className="input tnum" inputMode="decimal" value={f.allowance} onChange={(e) => set("allowance", e.target.value)} />
        </Field>
        <Field label="Per">
          <select className="input" value={f.period} onChange={(e) => set("period", Number(e.target.value))}>
            {PERIODS.map((p) => (
              <option key={p.secs} value={p.secs}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Cap per payment">
          <input className="input tnum" inputMode="decimal" value={f.maxPayment} onChange={(e) => set("maxPayment", e.target.value)} />
        </Field>
        <Field label="Payments per period">
          <input className="input tnum" inputMode="numeric" value={f.maxPayments} onChange={(e) => set("maxPayments", e.target.value)} />
        </Field>
        <Field label="Policy lasts (days)">
          <input className="input tnum" inputMode="numeric" value={f.days} onChange={(e) => set("days", e.target.value)} />
        </Field>
        <div className="flex items-end pb-2 text-[12px] text-ink-muted">Ends {Number(f.days) > 0 ? dateLabel(expiresAt) : "—"}</div>
      </div>
      <div>
        <span className="label">Approved services</span>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {snap.services.map((s) => (
            <label key={s.id} className="flex items-center gap-2 h-9 px-2.5 rounded border border-line hover:border-line-strong text-[13px] cursor-pointer">
              <input
                type="checkbox"
                checked={f.services.includes(s.id)}
                onChange={(e) => set("services", e.target.checked ? [...f.services, s.id] : f.services.filter((x) => x !== s.id))}
              />
              <span className="flex-1 truncate">{s.name}</span>
              {s.suspended && <Badge tone="bad">Suspended</Badge>}
            </label>
          ))}
        </div>
        <input className="input mt-2 font-mono text-[12.5px]" placeholder="Other service ids, comma separated" value={f.extra} onChange={(e) => set("extra", e.target.value)} />
        <span className="block mt-1 text-[11.5px] text-ink-muted">An id that nobody registered can be listed, but the registry will refuse every payment to it.</span>
      </div>
      {!valid && (
        <p className="text-[12px] text-held">Every limit must be above zero, the cap no larger than the allowance, at most 32 services, a valid address and a name.</p>
      )}
      <div className="flex justify-end gap-2 pt-2 border-t border-line">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!valid || busy}>
          {busy ? "Saving…" : editing ? "Save policy" : "Add spender"}
        </Button>
      </div>
      <p className="text-[11.5px] text-ink-muted">Saving overwrites every limit at once. Usage so far this period is kept.</p>
    </form>
  );
}

export function Spenders() {
  const { snap, isOwner, run, name } = useApp();
  const [editing, setEditing] = useState<Spender | null | "new">(null);
  if (!snap) return null;

  return (
    <>
      <PageHead
        title="Spenders"
        sub="Every person and agent on the account, with the rules the contract enforces for them. Limits are written in dollars and service names, so they can be read before anything is spent."
        action={isOwner ? <Button variant="primary" onClick={() => setEditing("new")}><Icon name="plus" /> Add spender</Button> : undefined}
      />
      <div className="grid md:grid-cols-2 gap-4">
        {snap.spenders.map((s) => (
          <Card key={s.address}>
            <div className="flex items-start gap-3">
              <Avatar name={name(s.address)} kind={s.policy.kind} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[15px] font-semibold">{name(s.address)}</span>
                  <KindBadge kind={s.policy.kind} />
                  {s.address === snap.account.owner && <Badge tone="accent">Owner</Badge>}
                </div>
                <Addr value={s.address} />
              </div>
              <SpenderStatus s={s} now={snap.now} />
            </div>
            <div className="mt-4"><AllowanceLine s={s} /></div>
            <dl className="mt-4 grid grid-cols-3 gap-3 text-[12.5px]">
              <div><dt className="eyebrow mb-1">Per payment</dt><dd className="font-semibold tnum">{fmt(s.policy.maxPayment)}</dd></div>
              <div><dt className="eyebrow mb-1">Payments</dt><dd className="font-semibold tnum">{s.usage.count} / {s.policy.maxPayments} a {periodLabel(s.policy.period)}</dd></div>
              <div><dt className="eyebrow mb-1">Ends</dt><dd className="font-semibold">{dateLabel(s.policy.expiresAt)}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {s.policy.services.map((id) => {
                const reg = snap.services.find((x) => x.id === id);
                return (
                  <Badge key={id} tone={!reg || reg.suspended ? "bad" : "neutral"}>
                    {serviceName(snap, id)}
                    {!reg ? " · unregistered" : reg.suspended ? " · suspended" : ""}
                  </Badge>
                );
              })}
            </div>
            {isOwner && (
              <div className="mt-5 pt-4 border-t border-line flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setEditing(s)}>Edit policy</Button>
                <Button size="sm" onClick={() => run((b) => b.setSpenderPaused(s.address, !s.policy.paused), s.policy.paused ? "Spender resumed" : "Spender paused")}>
                  {s.policy.paused ? "Resume" : "Pause"}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (confirm(`Remove ${name(s.address)}? New payments from this spender will be refused.`)) run((b) => b.removeSpender(s.address), "Spender removed");
                  }}
                >
                  Remove
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add a spender" : `Edit ${editing ? name(editing.address) : ""}'s policy`} wide>
        {editing !== null && <PolicyForm editing={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  );
}
