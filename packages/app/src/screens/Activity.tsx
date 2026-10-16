import { useState } from "react";
import type { Activity as A } from "../engine/types";
import { useApp } from "../state";
import { PageHead } from "../ui/Shell";
import { ActivityRow } from "../ui/domain";
import { Card, Empty, cx } from "../ui/kit";

const FILTERS: Array<{ key: string; label: string; match: (a: A) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "paid", label: "Paid", match: (a) => a.kind === "paid" || a.kind === "settled" },
  { key: "held", label: "Held & refused", match: (a) => a.kind === "refused" },
  { key: "approvals", label: "Approvals", match: (a) => a.kind === "requested" || a.kind === "approved" || a.kind === "declined" || a.kind === "settled" },
  { key: "agents", label: "Agents", match: (a) => a.via === "agent" },
  { key: "rules", label: "Rule changes", match: (a) => a.kind === "policy" || a.kind === "deposit" || a.kind === "withdraw" },
];

export function Activity() {
  const { snap, isOwner } = useApp();
  const [f, setF] = useState("all");
  if (!snap) return null;
  const filter = FILTERS.find((x) => x.key === f)!;
  const mineOnly = (a: A) => isOwner || !a.spender || a.spender === snap.me;
  const items = snap.activity.filter((a) => mineOnly(a) && filter.match(a));

  return (
    <>
      <PageHead
        title="Activity"
        sub="Receipts read from the contract's events, newest first. A payment refused before it reached the chain left nothing on chain; it is kept here, in this browser, so you can see it."
      />
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
        {FILTERS.map((x) => (
          <button
            key={x.key}
            onClick={() => setF(x.key)}
            className={cx("h-8 px-3.5 rounded-full text-[13px] whitespace-nowrap", f === x.key ? "bg-ink text-white" : "bg-surface-muted text-ink-secondary hover:text-ink")}
          >
            {x.label}
          </button>
        ))}
      </div>
      <Card>
        <ul className="divide-y divide-line -my-3">
          {items.map((a) => (
            <ActivityRow key={a.id} a={a} />
          ))}
        </ul>
        {items.length === 0 && <Empty title="Nothing here yet" />}
      </Card>
    </>
  );
}
