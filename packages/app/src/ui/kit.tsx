import { useEffect, useState, type ReactNode } from "react";
import { fmt, pct } from "../lib/money";

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "held";

export function Button({
  children,
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const v: Record<Variant, string> = {
    primary: "bg-ink text-white border-ink hover:bg-ink/85",
    secondary: "bg-white text-ink border-line-strong hover:border-ink",
    ghost: "bg-transparent text-ink-secondary border-transparent hover:bg-surface-muted hover:text-ink",
    danger: "bg-white text-destructive border-destructive/40 hover:bg-destructive-soft",
    held: "bg-held text-white border-held hover:bg-held/90",
  };
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded border font-medium transition-colors disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap",
        size === "sm" ? "h-8 px-2.5 text-[12px]" : "h-10 px-4 text-[13px]",
        v[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Card({ children, className, title, action, eyebrow }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; eyebrow?: string }) {
  return (
    <section className={cx("panel", className)}>
      {(title || action || eyebrow) && (
        <header className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-4">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
            {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

type Tone = "neutral" | "ok" | "held" | "bad" | "accent" | "agent";

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  const t: Record<Tone, string> = {
    neutral: "bg-surface-muted text-ink-secondary border-line",
    ok: "bg-ok-soft text-ok border-ok/20",
    held: "bg-held-soft text-held border-held-line",
    bad: "bg-destructive-soft text-destructive border-destructive/20",
    accent: "bg-accent-soft text-accent border-accent/20",
    agent: "bg-[#F1EEFD] text-[#5B45C9] border-[#5B45C9]/20",
  };
  return (
    <span className={cx("inline-flex items-center gap-1 h-[22px] px-2 rounded-sm border font-mono text-[10.5px] font-medium uppercase tracking-wider whitespace-nowrap", t[tone], className)}>
      {children}
    </span>
  );
}

export function Meter({ value, max, tone = "ink", className }: { value: bigint; max: bigint; tone?: "ink" | "held" | "ok"; className?: string }) {
  const p = pct(value, max);
  const color = tone === "held" || p >= 90 ? "bg-held" : tone === "ok" ? "bg-ok" : "bg-ink";
  return (
    <div className={cx("h-1.5 w-full rounded-full bg-surface-muted overflow-hidden", className)} role="meter" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${p}%` }} />
    </div>
  );
}

export function Money({ value, className }: { value: bigint; className?: string }) {
  return <span className={cx("tnum", className)}>{fmt(value)}</span>;
}

export function short(a: string, n = 4): string {
  if (!a) return "";
  return a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
}

export function Addr({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        navigator.clipboard?.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={cx("font-mono text-[12px] text-ink-secondary hover:text-ink", className)}
    >
      {copied ? "copied" : short(value, 5)}
    </button>
  );
}

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx("panel p-4 sm:p-5", className)}>
      <div className="eyebrow">{label}</div>
      <div className="mt-2 text-[24px] sm:text-[28px] font-semibold tracking-tight tnum leading-none">{value}</div>
      {sub && <div className="mt-2 text-[12px] text-ink-muted">{sub}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <div className="mx-auto w-10 h-10 rounded border border-dashed border-line-strong grid-bg mb-3" />
      <div className="text-[14px] font-medium">{title}</div>
      {children && <div className="text-[13px] text-ink-muted mt-1 max-w-sm mx-auto">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className={cx("relative w-full bg-white rounded-t-xl sm:rounded-xl shadow-float max-h-[92vh] overflow-y-auto rise", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}>
        <div className="sticky top-0 z-10 bg-white flex items-center justify-between px-5 h-14 border-b border-line">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 inline-flex items-center justify-center rounded hover:bg-surface-muted" aria-label="Close">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[11.5px] text-ink-muted">{hint}</span>}
    </label>
  );
}

export function ago(at: number, now: number): string {
  const d = Math.max(0, now - at);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  const days = Math.floor(d / 86400);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function until(at: number, now: number): string {
  const d = at - now;
  if (d <= 0) return "now";
  if (d < 3600) return `in ${Math.ceil(d / 60)}m`;
  if (d < 86400) return `in ${Math.ceil(d / 3600)}h`;
  return `in ${Math.ceil(d / 86400)}d`;
}

export function dateLabel(at: number): string {
  return new Date(at * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function Icon({ name, className = "w-4 h-4" }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    overview: <path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z" />,
    pay: <path d="M3 7h18v10H3zM3 11h18M7 15h3" />,
    assistant: <path d="M5 5h14v10H9l-4 4zM9 10h.01M12 10h.01M15 10h.01" />,
    approvals: <path d="M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
    spenders: <path d="M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3 3 0 100-6 3 3 0 000 6zM21 19v-1a4 4 0 00-3-3.85M16 4.15a3 3 0 010 5.7" />,
    agents: <path d="M9 3v2M15 3v2M5 8h14v10H5zM9 12h.01M15 12h.01M9 15h6M2 12h3M19 12h3" />,
    services: <path d="M4 6h16M4 12h16M4 18h10" />,
    activity: <path d="M3 12h4l3 7 4-14 3 7h4" />,
    settings: <path d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H3a2 2 0 110-4h.1a1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 002.9-1.2V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 001.2 2.9H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />,
    check: <path d="M5 12l5 5 9-10" />,
    x: <path d="M6 6l12 12M18 6L6 18" />,
    pause: <path d="M9 5v14M15 5v14" />,
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    external: <path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" />,
    clock: <path d="M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z" />,
    lock: <path d="M6 11h12v9H6zM9 11V8a3 3 0 016 0v3" />,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function Logo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 4C9.5 4 5 8.2 5 13.5h19.5c-.2-4.8-4.5-9.5-8.5-9.5z" fill="currentColor" />
      <path d="M16 7.2c2.6 0 4.4 2 4.7 4.5h-9.4c.3-2.5 2.1-4.5 4.7-4.5z" fill="#d25611" />
      <path d="M4 14.5C4 13.7 4.7 13 5.5 13h21c.8 0 1.5.7 1.5 1.5s-.7 1.5-1.5 1.5h-21c-.8 0-1.5-.7-1.5-1.5z" fill="currentColor" />
      <path d="M5 18c.3 5.2 4.8 9 11.5 9 4.8 0 8.5-2 10.2-5.2l-3.2-1.8c-1.2 2-3.8 3.5-7 3.5-4.5 0-7.4-2.5-7.8-5.5H5z" fill="currentColor" />
    </svg>
  );
}
