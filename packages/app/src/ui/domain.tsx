import type { ReactNode } from "react";
import { fmt } from "../lib/money";
import { EXCEPTION_ELIGIBLE, Rule, ruleTitle } from "../engine/rules";
import type { Activity, ApprovalRequest, Service, Snapshot, Spender, Verdict } from "../engine/types";
import { useApp } from "../state";
import { Addr, Badge, Icon, Meter, ago, cx, dateLabel, short } from "./kit";

export function explorer(hash?: string): string | null {
  if (!hash) return null;
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

export function periodLabel(seconds: number): string {
  if (seconds === 86_400) return "day";
  if (seconds === 7 * 86_400) return "week";
  if (seconds === 30 * 86_400) return "month";
  return `${Math.round(seconds / 86_400)} days`;
}

export function serviceName(snap: Snapshot, id: string): string {
  return snap.services.find((s) => s.id === id)?.name ?? id;
}

export function SpenderStatus({ s, now }: { s: Spender; now: number }) {
  if (s.policy.paused) return <Badge tone="held">Paused</Badge>;
  if (now >= s.policy.expiresAt) return <Badge tone="bad">Expired</Badge>;
  return <Badge tone="ok">Active</Badge>;
}

export function KindBadge({ kind }: { kind: "person" | "agent" }) {
  return kind === "agent" ? <Badge tone="agent">Agent</Badge> : <Badge>Person</Badge>;
}

export function Avatar({ name, kind, size = 32 }: { name: string; kind: "person" | "agent"; size?: number }) {
  return (
    <span
      className={cx(
        "inline-flex items-center justify-center shrink-0 font-semibold text-[12px]",
        kind === "agent" ? "rounded-[5px] bg-[#F1EEFD] text-[#5B45C9] border border-[#5B45C9]/20" : "rounded-full bg-surface-muted text-ink border border-line",
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {kind === "agent" ? <Icon name="agents" className="w-4 h-4" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** One spender's allowance, legible in dollars. */
export function AllowanceLine({ s, compact }: { s: Spender; compact?: boolean }) {
  const left = s.policy.allowance - s.usage.spent;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="tnum">
          <span className="font-semibold text-ink">{fmt(s.usage.spent)}</span>
          <span className="text-ink-muted"> of {fmt(s.policy.allowance)} / {periodLabel(s.policy.period)}</span>
        </span>
        {!compact && <span className="text-ink-muted tnum">{fmt(left)} left</span>}
      </div>
      <Meter value={s.usage.spent} max={s.policy.allowance} className="mt-1.5" />
    </div>
  );
}

const ORDER: Array<{ codes: number[]; label: string }> = [
  { codes: [Rule.AccountPaused], label: "Account is active" },
  { codes: [Rule.UnknownSpender, Rule.SpenderPaused, Rule.PolicyExpired], label: "Spender is active and in date" },
  { codes: [Rule.InvalidAmount], label: "Amount is above zero" },
  { codes: [Rule.ServiceNotAllowed], label: "Service is on the spender's list" },
  { codes: [Rule.OverPaymentCap], label: "Within the per-payment cap" },
  { codes: [Rule.OverFrequency], label: "Within payments per period" },
  { codes: [Rule.OverAllowance], label: "Within the allowance left" },
  { codes: [Rule.UnknownService, Rule.ServiceSuspended], label: "Registry resolves the service" },
  { codes: [Rule.InsufficientFunds], label: "Account balance covers it" },
];

/** The contract's checks in order, with the arithmetic behind each one. */
export function CheckList({ spender, service, amount, verdict, services, balance }: { spender: Spender; service: string; amount: bigint; verdict: Verdict; services: Service[]; balance: bigint }) {
  const failAt = verdict.rule === Rule.Ok ? -1 : ORDER.findIndex((r) => r.codes.includes(verdict.rule));
  const p = spender.policy;
  const svc = services.find((s) => s.id === service);
  const detail = (i: number): ReactNode => {
    switch (i) {
      case 3:
        return p.services.includes(service) ? `“${service}” is approved` : `“${service}” is not on the list`;
      case 4:
        return `${fmt(amount)} vs cap ${fmt(p.maxPayment)}${amount > p.maxPayment ? ` · ${fmt(amount - p.maxPayment)} over` : ""}`;
      case 5:
        return `${verdict.periodCount} used, this would be ${verdict.periodCount + 1} of ${p.maxPayments}`;
      case 6: {
        const after = verdict.periodSpent + amount;
        return `${fmt(verdict.periodSpent)} + ${fmt(amount)} = ${fmt(after)} of ${fmt(p.allowance)}${after > p.allowance ? ` · ${fmt(after - p.allowance)} over` : ""}`;
      }
      case 7:
        if (!svc) return "No one registered this id";
        if (svc.suspended) return "Suspended by the registry";
        return <>pays <span className="font-mono">{short(svc.payee, 5)}</span></>;
      case 8:
        return `${fmt(balance)} in the account`;
      default:
        return null;
    }
  };
  return (
    <ol className="divide-y divide-line">
      {ORDER.map((row, i) => {
        const state = failAt === -1 || i < failAt ? "pass" : i === failAt ? "fail" : "skip";
        return (
          <li key={row.label} className={cx("flex items-start gap-3 py-2.5", state === "skip" && "opacity-45")}>
            <span
              className={cx(
                "mt-0.5 w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0",
                state === "pass" && "bg-ok-soft text-ok",
                state === "fail" && (EXCEPTION_ELIGIBLE.has(verdict.rule) ? "bg-held text-white" : "bg-destructive text-white"),
                state === "skip" && "bg-surface-muted text-ink-muted",
              )}
            >
              {state === "pass" ? <Icon name="check" className="w-3 h-3" /> : state === "fail" ? <Icon name="x" className="w-3 h-3" /> : <span className="w-1 h-1 rounded-full bg-current" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{row.label}</div>
              {state !== "skip" && detail(i) && <div className="text-[12px] text-ink-muted tnum mt-0.5">{detail(i)}</div>}
              {state === "skip" && <div className="text-[12px] text-ink-muted">Not reached: the contract stops at the first refusal.</div>}
            </div>
            <span className="eyebrow pt-0.5">{String(i + 1).padStart(2, "0")}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function RuleBadge({ rule }: { rule: number }) {
  return <Badge tone={EXCEPTION_ELIGIBLE.has(rule) ? "held" : "bad"}>{ruleTitle(rule)}</Badge>;
}

export function StatusBadge({ status }: { status: ApprovalRequest["status"] }) {
  const map = { pending: ["held", "Waiting"], approved: ["accent", "Approved · not settled"], declined: ["neutral", "Declined"], settled: ["ok", "Settled"] } as const;
  const [tone, label] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const KIND: Record<Activity["kind"], { label: string; tone: "ok" | "held" | "bad" | "neutral" | "accent" }> = {
  paid: { label: "Paid", tone: "ok" },
  refused: { label: "Held", tone: "held" },
  requested: { label: "Asked", tone: "held" },
  approved: { label: "Approved", tone: "accent" },
  declined: { label: "Declined", tone: "neutral" },
  settled: { label: "Settled", tone: "ok" },
  policy: { label: "Rules", tone: "neutral" },
  deposit: { label: "Funded", tone: "accent" },
  withdraw: { label: "Withdrawn", tone: "neutral" },
};

export function ActivityRow({ a }: { a: Activity }) {
  const { snap, name } = useApp();
  if (!snap) return null;
  const who = a.spender ? name(a.spender) : "Owner";
  const svc = a.service ? serviceName(snap, a.service) : "";
  const k = KIND[a.kind];
  const byAgent = a.via === "agent" || snap.spenders.find((s) => s.address === a.spender)?.policy.kind === "agent";
  // Agents cannot ask for exceptions, so for them every refusal is final.
  const refusedHard = a.kind === "refused" && a.rule !== undefined && (byAgent || !EXCEPTION_ELIGIBLE.has(a.rule));
  let text: ReactNode;
  switch (a.kind) {
    case "paid":
      text = <><b className="font-semibold">{who}</b> paid {svc}</>;
      break;
    case "refused":
      text = <><b className="font-semibold">{who}</b>'s payment to {svc} was {refusedHard ? "refused" : "held by the rules"}</>;
      break;
    case "requested":
      text = <><b className="font-semibold">{who}</b> asked the owner to approve a payment to {svc}</>;
      break;
    case "approved":
      text = <>Owner approved request #{a.requestId}{a.spender ? ` from ${who}` : ""}</>;
      break;
    case "declined":
      text = <>Owner declined request #{a.requestId}{a.spender ? ` from ${who}` : ""}</>;
      break;
    case "settled":
      text = <>Request #{a.requestId} settled{svc ? ` to ${svc}` : ""}</>;
      break;
    case "deposit":
      text = <>{a.note ?? "Account funded"}</>;
      break;
    case "withdraw":
      text = <>Owner withdrew to <span className="font-mono">{short(a.note ?? "", 4)}</span></>;
      break;
    default:
      text = <>{a.note}{a.spender ? <> · <b className="font-semibold">{who}</b></> : null}</>;
  }
  const link = explorer(a.txHash);
  return (
    <li className="flex items-start gap-3 py-3">
      <Badge tone={refusedHard ? "bad" : k.tone} className="mt-0.5 w-[84px] justify-center shrink-0">{refusedHard ? "Refused" : k.label}</Badge>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] leading-snug">{text}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-muted">
          <span title={new Date(a.at * 1000).toLocaleString()}>{ago(a.at, snap.now)}</span>
          {a.memo && <span className="truncate max-w-[260px]">· “{a.memo}”</span>}
          {a.via === "x402" && <Badge tone="accent">x402</Badge>}
          {a.via === "agent" && <Badge tone="agent">by schedule</Badge>}
          {a.via === "assistant" && <Badge tone="accent">assistant draft</Badge>}
          {a.rule !== undefined && a.kind !== "paid" && <span>· {ruleTitle(a.rule)}{a.overBy && a.overBy > 0n && a.rule !== Rule.OverFrequency ? `, ${fmt(a.overBy)} over` : ""}</span>}
          {a.kind === "refused" && <span>· no money moved</span>}
          {link ? (
            <a className="inline-flex items-center gap-1 font-mono text-accent hover:underline" href={link} target="_blank" rel="noreferrer">
              {short(a.txHash!, 4)} <Icon name="external" className="w-3 h-3" />
            </a>
          ) : a.txHash ? (
            <span className="font-mono">tx {short(a.txHash, 4)}</span>
          ) : null}
        </div>
      </div>
      {a.amount !== undefined && (
        <div className={cx("text-[13.5px] font-semibold tnum shrink-0", (a.kind === "refused" || a.kind === "requested" || a.kind === "declined") && "text-ink-muted line-through decoration-1")}>
          {a.kind === "deposit" ? fmt(a.amount, { sign: true }) : fmt(a.amount)}
        </div>
      )}
    </li>
  );
}

export function RequestFacts({ r }: { r: ApprovalRequest }) {
  const { snap, name } = useApp();
  if (!snap) return null;
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-[12.5px]">
      <div><dt className="eyebrow mb-1">Spender</dt><dd>{name(r.spender)}</dd></div>
      <div><dt className="eyebrow mb-1">Service</dt><dd>{serviceName(snap, r.service)}</dd></div>
      <div><dt className="eyebrow mb-1">Caught by</dt><dd>{ruleTitle(r.rule)}{r.rule !== Rule.OverFrequency && r.rule !== Rule.ServiceNotAllowed ? <span className="text-held"> · {fmt(r.overBy)} over</span> : null}</dd></div>
      <div><dt className="eyebrow mb-1">Filed</dt><dd>{dateLabel(r.createdAt)}</dd></div>
      <div className="col-span-2"><dt className="eyebrow mb-1">Pays</dt><dd><Addr value={r.payee} /> <span className="text-ink-muted">(as resolved when filed)</span></dd></div>
      <div className="col-span-2"><dt className="eyebrow mb-1">Memo</dt><dd className="truncate">{r.memo || "—"}</dd></div>
    </dl>
  );
}
