import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../state";
import { Badge, Icon, Logo, cx, short } from "./kit";

const SITE = import.meta.env.BASE_URL.replace(/app\/?$/, "");
const SIDEBAR_COLLAPSED_KEY = "ecorouter.sidebar.collapsed";

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function Shell({ children }: { children: ReactNode }) {
  const { snap, route, isOwner, mine, toasts } = useApp();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);
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
    { path: "/marketplace", label: "Marketplace", icon: "services", show: true },
    { path: "/activity", label: "Activity", icon: "activity", show: true },
    { path: "/settings", label: "Settings", icon: "settings", show: true },
  ];

  const NavList = (isCollapsed = false) => (
    <div>
      <div className={cx("group-label px-2.5 mb-2", isCollapsed && "sr-only")}>Workspace</div>
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
                aria-label={isCollapsed ? n.label : undefined}
                title={isCollapsed ? n.label : undefined}
                className={cx(
                  "relative flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[14px] transition-colors",
                  isCollapsed && "justify-center px-0",
                  active ? "bg-white text-ink font-medium shadow-[0_1px_2px_rgba(0,0,0,0.05)] ring-1 ring-line" : "text-ink-secondary hover:bg-white/70 hover:text-ink",
                )}
              >
                <Icon name={n.icon} className="w-[17px] h-[17px] shrink-0" />
                <span className={isCollapsed ? "sr-only" : "flex-1"}>{n.label}</span>
                {!!n.badge && (isCollapsed
                  ? <span aria-hidden="true" className="absolute right-2 top-2 w-1.5 h-1.5 rounded-full bg-held" />
                  : <span className="min-w-5 h-5 px-1.5 rounded-full bg-held text-white text-[11px] font-mono inline-flex items-center justify-center">{n.badge}</span>)}
              </a>
            );
          })}
      </nav>
    </div>
  );

  const Identity = (isCollapsed = false) => (
    <div className="px-1 py-2">
      {isCollapsed ? (
        <span title={`Signed in as ${short(snap.me, 6)}`} className="flex justify-center text-ink-muted">
          <Icon name="spenders" />
          <span className="sr-only">Signed in as {short(snap.me, 6)}</span>
        </span>
      ) : (
        <>
          <div className="eyebrow mb-2">Signed in as</div>
          <div className="text-[13px] font-mono">{short(snap.me, 6)}</div>
          <div className="mt-2 text-[12px] text-ink-muted leading-snug">
            {isOwner ? "You own this account: you set the rules and decide exceptions." : mine ? "You spend inside your own policy." : "You have no policy on this account."}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className={cx("min-h-screen lg:grid transition-[grid-template-columns] duration-200 motion-reduce:transition-none", collapsed ? "lg:grid-cols-[64px_minmax(0,1fr)]" : "lg:grid-cols-[248px_minmax(0,1fr)]")}>
      {/* Sidebar */}
      <aside className={cx(
        "hidden lg:flex flex-col gap-5 sticky top-0 h-screen border-r border-line bg-surface-soft transition-[width,padding] duration-200 motion-reduce:transition-none",
        collapsed ? "items-center p-2" : "p-4",
      )}>
        <div className={cx("flex w-full", collapsed ? "flex-col items-center gap-1" : "items-center justify-between gap-2")}>
          <Brand collapsed={collapsed} />
          <button
            type="button"
            className="inline-flex w-8 h-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-white hover:text-ink"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name={collapsed ? "expand" : "collapse"} className="w-4 h-4" />
          </button>
        </div>
        <AccountChip collapsed={collapsed} />
        {NavList(collapsed)}
        <div className="mt-auto flex flex-col gap-3">
          {Identity(collapsed)}
          <a href={SITE} title={collapsed ? "ecorouter.xyz" : undefined} aria-label={collapsed ? "ecorouter.xyz" : undefined} className={cx("text-[13px] text-ink-muted hover:text-ink px-1", collapsed && "flex justify-center")}>
            {collapsed ? <Icon name="external" /> : "← ecorouter.xyz"}
          </a>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-line">
        <div className="flex items-center justify-between h-14 px-4">
          <Brand />
          <div className="flex items-center gap-2">
            <Badge tone="ok">Testnet</Badge>
            <button className="w-9 h-9 inline-flex items-center justify-center rounded-lg bg-white border border-line" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
              <Icon name={open ? "x" : "menu"} />
            </button>
          </div>
        </div>
        {open && (
          <div className="border-t border-line bg-white p-4 flex flex-col gap-4 max-h-[calc(100vh-56px)] overflow-y-auto">
            {NavList()}
            {Identity()}
          </div>
        )}
      </header>

      <main className="min-w-0">
        {snap.account.paused && (
          <div className="bg-held-soft border-b border-held-line text-held text-[13px] px-4 sm:px-8 py-2.5 flex items-center gap-2">
            <Icon name="pause" /> The account is paused. No payment or settlement can go through until the owner resumes it.
          </div>
        )}
        <div className="max-w-[1120px] mx-auto px-5 sm:px-10 py-8 sm:py-12">{children}</div>
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

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <a href="#/overview" aria-label="EcoRouter" className={cx("flex items-center gap-2.5", collapsed && "gap-0")}>
      <span className="w-8 h-8 rounded-full bg-ink flex items-center justify-center text-white shrink-0">
        <Logo className="w-4 h-4" />
      </span>
      {!collapsed && <span className="font-semibold text-[15px] tracking-tight">EcoRouter</span>}
    </a>
  );
}

function AccountChip({ collapsed = false }: { collapsed?: boolean }) {
  const { snap } = useApp();
  if (!snap) return null;
  if (collapsed) {
    return (
      <div title="Stellar testnet" className="flex justify-center py-1">
        <span className="w-2 h-2 rounded-full bg-ok" />
        <span className="sr-only">Stellar testnet</span>
      </div>
    );
  }
  return (
    <div className="px-1 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold truncate">{snap.account.name}</div>
        <Badge tone="ok">Testnet</Badge>
      </div>
      <div className="mt-1 font-mono text-[11px] text-ink-muted">{short(snap.account.id, 6)}</div>
    </div>
  );
}

export function PageHead({ title, sub, action, eyebrow }: { title: string; sub?: ReactNode; action?: ReactNode; eyebrow?: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-[-0.035em] leading-tight">{title}</h1>
        {sub && <p className="mt-2 text-[15.5px] text-ink-secondary max-w-2xl">{sub}</p>}
      </div>
      {action && <div className="flex gap-2 shrink-0">{action}</div>}
    </div>
  );
}
