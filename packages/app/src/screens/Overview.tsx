import { fmt } from "../lib/money";
import { useApp } from "../state";
import { PageHead } from "../ui/Shell";
import { ActivityRow, AllowanceLine, Avatar, KindBadge, SpenderStatus, periodLabel, serviceName } from "../ui/domain";
import { Badge, Button, Card, Empty, Icon, Stat, dateLabel } from "../ui/kit";

export function Overview() {
  const { snap, isOwner, mine, name, go } = useApp();
  if (!snap) return null;
  const spentAll = snap.spenders.reduce((n, s) => n + s.usage.spent, 0n);
  const allowAll = snap.spenders.reduce((n, s) => n + s.policy.allowance, 0n);
  const pending = snap.requests.filter((r) => r.status === "pending");
  const approved = snap.requests.filter((r) => r.status === "approved");
  const paidCount = snap.spenders.reduce((n, s) => n + s.usage.count, 0);
  const held = snap.activity.filter((a) => a.kind === "refused" && snap.now - a.at < 30 * 86_400).length;

  return (
    <>
      <PageHead
        eyebrow={snap.account.name}
        title={isOwner ? `Good to see you, ${name(snap.me)}` : `Hi ${name(snap.me)}`}
        sub={isOwner ? "Here is what your team spent, and anything waiting on you." : "Here is your allowance and what you have spent from the team account."}
        action={
          mine ? (
            <>
              <Button onClick={() => go("/assistant")}>
                <Icon name="assistant" /> Ask the assistant
              </Button>
              <Button variant="primary" onClick={() => go("/pay")}>
                <Icon name="plus" /> New payment
              </Button>
            </>
          ) : undefined
        }
      />

      {isOwner && pending.length > 0 && (
        <button onClick={() => go("/approvals")} className="w-full text-left mb-5 rounded-lg border border-held-line bg-held-soft px-4 py-3 flex items-center gap-3 hover:border-held">
          <span className="w-8 h-8 rounded-full bg-held text-white inline-flex items-center justify-center font-mono text-[13px]">{pending.length}</span>
          <span className="flex-1 text-[13.5px]">
            <b className="font-semibold text-held">{pending.length === 1 ? "A payment is" : `${pending.length} payments are`} waiting for your decision.</b>{" "}
            <span className="text-ink-secondary">
              {name(pending[0].spender)} asked to pay {fmt(pending[0].amount)} to {serviceName(snap, pending[0].service)}. No money has moved.
            </span>
          </span>
          <Icon name="arrow" className="w-4 h-4 text-held" />
        </button>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <Stat label="Account balance" value={fmt(snap.account.balance)} sub="USDC held by the contract" />
        <Stat label="Spent this period" value={fmt(spentAll)} sub={`of ${fmt(allowAll)} in allowances`} />
        <Stat label="Payments" value={paidCount} sub={`${held} held by the rules in 30 days`} />
        <Stat label="Waiting on owner" value={pending.length + approved.length} sub={`${pending.length} to decide · ${approved.length} to settle`} />
      </div>

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-4 sm:gap-6">
        <div className="flex flex-col gap-4 sm:gap-6 min-w-0">
          {mine && (
            <Card eyebrow="Your policy" title="What you can spend">
              <AllowanceLine s={mine} />
              <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12.5px]">
                <div><dt className="eyebrow mb-1">Per payment</dt><dd className="font-semibold tnum">{fmt(mine.policy.maxPayment)}</dd></div>
                <div><dt className="eyebrow mb-1">Payments</dt><dd className="font-semibold tnum">{mine.usage.count} of {mine.policy.maxPayments}</dd></div>
                <div><dt className="eyebrow mb-1">Resets</dt><dd className="font-semibold">every {periodLabel(mine.policy.period)}</dd></div>
                <div><dt className="eyebrow mb-1">Until</dt><dd className="font-semibold">{dateLabel(mine.policy.expiresAt)}</dd></div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {mine.policy.services.map((id) => (
                  <Badge key={id}>{serviceName(snap, id)}</Badge>
                ))}
              </div>
            </Card>
          )}

          <Card title="Spenders" eyebrow="People and agents" action={<Button size="sm" variant="ghost" onClick={() => go("/spenders")}>All spenders <Icon name="arrow" className="w-3.5 h-3.5" /></Button>}>
            <ul className="divide-y divide-line -my-2">
              {snap.spenders.map((s) => (
                <li key={s.address} className="py-3 flex items-center gap-3">
                  <Avatar name={name(s.address)} kind={s.policy.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[13.5px] font-medium truncate">{name(s.address)}</span>
                      <KindBadge kind={s.policy.kind} />
                      <span className="ml-auto"><SpenderStatus s={s} now={snap.now} /></span>
                    </div>
                    <AllowanceLine s={s} compact />
                  </div>
                </li>
              ))}
              {snap.spenders.length === 0 && <Empty title="No spenders yet">Add a person or an agent from Spenders.</Empty>}
            </ul>
          </Card>
        </div>

        <Card title="Recent activity" eyebrow="Receipts" action={<Button size="sm" variant="ghost" onClick={() => go("/activity")}>All <Icon name="arrow" className="w-3.5 h-3.5" /></Button>}>
          <ul className="divide-y divide-line -my-3">
            {snap.activity.slice(0, 8).map((a) => (
              <ActivityRow key={a.id} a={a} />
            ))}
          </ul>
          {snap.activity.length === 0 && <Empty title="Nothing yet">Payments and decisions show up here.</Empty>}
        </Card>
      </div>
    </>
  );
}
