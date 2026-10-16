import { useState, type ReactNode } from "react";
import { SandboxBackend } from "../engine/sandbox";
import { useApp } from "../state";
import { Badge, Icon, Logo, cx, short } from "./kit";

const SITE = import.meta.env.BASE_URL.replace(/app\/?$/, "");

export function Shell({ children }: { children: ReactNode }) {
  const { snap, route, go, isOwner, mine, toasts, backend, refresh, name } = useApp();
  const [open, setOpen] = useState(false);
  if (!snap) return null;
  const pending = snap.requests.filter((r) => r.status === "pending" && (isOwner || r.spender === snap.me)).length;
  const toSettle = snap.requests.filter((r) => r.status === "approved" && (isOwner || r.spender === snap.me)).length;

  const nav: Array<{ path: string; label: string; icon: string; badge?: number; show: boolean }> = [
    { path: "/overview", label: "Overview", icon: "overview", show: true },
    { path: "/pay", label: "New payment", icon: "pay", show: !!mine },
    { path: "/assistant", label: "Assistant", icon: "assistant", show: !!mine },
    { path: "/approvals", label: "Approvals", icon: "approvals", badge: pending + toSettle, show: true },
    { path: "/spenders", label: "Spenders", icon: "spenders", show: true },
    { path: "/agents", label: "Agents", icon: "agents", show: true },
    { path: "/services", label: "Services", icon: "services", show: true },
    { path: "/activity", label: "Activity", icon: "activity", show: true },
    { path: "/settings", label: "Settings", icon: "settings", show: true },
  ];

  const people = snap.spenders.filter((s) => s.policy.kind === "person").map((s) => s.address);
  if (!people.includes(snap.account.owner)) people.unshift(snap.account.owner);

  const NavList = (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {nav
        .filter((n) => n.show)
        .map((n) => {
          const active = route.startsWith(n.path);
          return (
            <a
              key={n.path}
              href={`#${n.path}`}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex items-center gap-2.5 h-9 px-2.5 rounded text-[13.5px] transition-colors",
                active ? "bg-white text-ink font-medium shadow-subtle border border-line" : "text-ink-secondary hover:text-ink hover:bg-white/60 border border-transparent",
              )}
            >
              <Icon name={n.icon} className="w-[17px] h-[17px] shrink-0" />
              <span className="flex-1">{n.label}</span>
              {!!n.badge && <span className="min-w-5 h-5 px-1.5 rounded-full bg-held text-white text-[11px] font-mono inline-flex items-center justify-center">{n.badge}</span>}
            </a>
          );
        })}
    </nav>
  );

  const Identity = (
    <div className="panel p-3">
      <div className="eyebrow mb-2">Signed in as</div>
      {backend instanceof SandboxBackend ? (
        <select
          aria-label="Act as"
          className="input h-9 text-[13px]"
          value={snap.me}
          onChange={async (e) => {
            backend.actAs(e.target.value);
            await refresh();
            go("/overview");
          }}
        >
          {people.map((a) => (
            <option key={a} value={a}>
              {name(a)} {a === snap.account.owner ? "· owner" : "· spender"}
            </option>
          ))}
        </select>
      ) : (
        <div className="text-[13px] font-mono">{short(snap.me, 6)}</div>
      )}
      <div className="mt-2 text-[11.5px] text-ink-muted leading-snug">
        {isOwner ? "You own this account: you set the rules and decide exceptions." : mine ? "You spend inside your own policy." : "You have no policy on this account."}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      {/* Sidebar */}
      <aside className="hidden lg:flex flex-col gap-5 sticky top-0 h-screen p-4 border-r border-line bg-surface-soft">
        <Brand />
        <AccountChip />
        {NavList}
        <div className="mt-auto flex flex-col gap-3">
          {Identity}
          <a href={SITE} className="text-[12px] font-mono text-ink-muted hover:text-ink px-1">← ecorouter.xyz</a>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-line">
        <div className="flex items-center justify-between h-14 px-4">
          <Brand />
          <div className="flex items-center gap-2">
            {snap.mode === "sandbox" ? <Badge tone="accent">Sandbox</Badge> : <Badge tone="ok">Testnet</Badge>}
            <button className="w-9 h-9 inline-flex items-center justify-center rounded border border-line-strong" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
              <Icon name={open ? "x" : "menu"} />
            </button>
          </div>
        </div>
        {open && (
          <div className="border-t border-line bg-surface-soft p-4 flex flex-col gap-4 max-h-[calc(100vh-56px)] overflow-y-auto">
            {NavList}
            {Identity}
          </div>
        )}
      </header>

      <main className="min-w-0">
        {snap.account.paused && (
          <div className="bg-held-soft border-b border-held-line text-held text-[13px] px-4 sm:px-8 py-2.5 flex items-center gap-2">
            <Icon name="pause" /> The account is paused. No payment or settlement can go through until the owner resumes it.
          </div>
        )}
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-8">{children}</div>
      </main>

      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col gap-2 sm:w-[360px]" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "rise rounded-lg border px-4 py-3 shadow-card bg-white",
              t.tone === "ok" && "border-ok/30",
              t.tone === "held" && "border-held-line bg-held-soft",
              t.tone === "bad" && "border-destructive/30",
            )}
          >
            <div className={cx("text-[13px] font-semibold", t.tone === "ok" && "text-ok", t.tone === "held" && "text-held", t.tone === "bad" && "text-destructive")}>{t.title}</div>
            {t.detail && <div className="text-[12.5px] text-ink-secondary mt-0.5">{t.detail}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Brand() {
  return (
    <a href="#/overview" className="flex items-center gap-2.5">
      <span className="w-7 h-7 rounded-[3px] bg-ink flex items-center justify-center text-white">
        <Logo className="w-4 h-4" />
      </span>
      <span className="font-semibold text-[15px] tracking-tight">EcoRouter</span>
    </a>
  );
}

function AccountChip() {
  const { snap } = useApp();
  if (!snap) return null;
  return (
    <div className="panel p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold truncate">{snap.account.name}</div>
        {snap.mode === "sandbox" ? <Badge tone="accent">Sandbox</Badge> : <Badge tone="ok">Testnet</Badge>}
      </div>
      <div className="mt-1 font-mono text-[11px] text-ink-muted">{short(snap.account.id, 6)}</div>
    </div>
  );
}

export function PageHead({ title, sub, action, eyebrow }: { title: string; sub?: ReactNode; action?: ReactNode; eyebrow?: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-tight leading-tight">{title}</h1>
        {sub && <p className="mt-1.5 text-[14px] text-ink-secondary max-w-2xl">{sub}</p>}
      </div>
      {action && <div className="flex gap-2 shrink-0">{action}</div>}
    </div>
  );
}
