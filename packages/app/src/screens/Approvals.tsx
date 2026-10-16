import { useState } from "react";
import { fmt } from "../lib/money";
import type { ApprovalRequest } from "../engine/types";
import { useApp } from "../state";
import { PageHead } from "../ui/Shell";
import { Avatar, RequestFacts, StatusBadge, serviceName } from "../ui/domain";
import { Button, Card, Empty, ago, cx, until } from "../ui/kit";

type Tab = "open" | "history";

export function Approvals() {
  const { snap, isOwner, run, name } = useApp();
  const [tab, setTab] = useState<Tab>("open");
  if (!snap) return null;
  const visible = snap.requests.filter((r) => isOwner || r.spender === snap.me);
  const open = visible.filter((r) => r.status === "pending" || r.status === "approved");
  const history = visible.filter((r) => r.status === "declined" || r.status === "settled");
  const list = tab === "open" ? open : history;

  const actions = (r: ApprovalRequest) => {
    const expired = snap.now >= r.expiresAt;
    const canSettle = isOwner || r.spender === snap.me;
    if (expired && (r.status === "pending" || r.status === "approved")) return <span className="text-[12.5px] text-ink-muted">Expired. File a new request if it is still needed.</span>;
    if (r.status === "pending" && isOwner)
      return (
        <>
          <Button variant="primary" size="sm" onClick={() => run((b) => b.approve(r.id), `Approved #${r.id}. No money has moved yet.`)}>Approve</Button>
          <Button variant="danger" size="sm" onClick={() => run((b) => b.decline(r.id), `Declined #${r.id}`)}>Decline</Button>
        </>
      );
    if (r.status === "pending") return <span className="text-[12.5px] text-ink-muted">Waiting for the owner. Expires {until(r.expiresAt, snap.now)}.</span>;
    if (r.status === "approved")
      return (
        <>
          {canSettle && (
            <Button variant="primary" size="sm" onClick={() => run((b) => b.settle(r.id), `Settled #${r.id}: ${fmt(r.amount)} paid`)}>
              Settle payment
            </Button>
          )}
          {isOwner && <Button variant="danger" size="sm" onClick={() => run((b) => b.decline(r.id), `Declined #${r.id}`)}>Decline</Button>}
        </>
      );
    return null;
  };

  return (
    <>
      <PageHead
        title="Approvals"
        sub={
          isOwner
            ? "Payments your rules held, sent to you by the person who tried them. Approving moves no money: settlement is its own transaction, and it refuses if the service's payee changed since the request was filed."
            : "Payments you asked the owner to approve. Once approved, you or the owner can settle them."
        }
      />

      <div className="inline-flex p-1 rounded-md bg-surface-muted border border-line mb-5" role="tablist">
        {(["open", "history"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx("h-8 px-3.5 rounded text-[13px] capitalize", tab === t ? "bg-white shadow-subtle font-medium" : "text-ink-secondary")}
          >
            {t === "open" ? `Open (${open.length})` : `History (${history.length})`}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {list.map((r) => {
          const kind = snap.spenders.find((s) => s.address === r.spender)?.policy.kind ?? "person";
          return (
            <Card key={r.id} className={cx(r.status === "pending" && "border-held-line")}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Avatar name={name(r.spender)} kind={kind} size={36} />
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold">
                      {fmt(r.amount)} <span className="font-normal text-ink-secondary">to {serviceName(snap, r.service)}</span>
                    </div>
                    <div className="text-[12px] text-ink-muted">Request #{r.id} · {ago(r.createdAt, snap.now)}</div>
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <RequestFacts r={r} />
              <div className="mt-4 pt-4 border-t border-line flex flex-wrap items-center gap-2">{actions(r)}</div>
            </Card>
          );
        })}
        {list.length === 0 && (
          <Card>
            <Empty title={tab === "open" ? "Nothing waiting" : "No decisions yet"}>
              {tab === "open" ? "When a person's payment is held by their rules, they can send it here for a one-off decision." : "Declined and settled requests show up here."}
            </Empty>
          </Card>
        )}
      </div>
    </>
  );
}
