import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ContractError, ruleDetail, ruleTitle } from "./engine/rules";
import type { Backend, Snapshot, Spender } from "./engine/types";
import { configFromEnv } from "./chain/config";

type SessionMode = "testnet" | null;
const SESSION_KEY = "ecorouter.session";

function readSession(): SessionMode {
  try {
    const v = localStorage.getItem(SESSION_KEY);
    return v === "testnet" ? v : null;
  } catch {
    return null;
  }
}

function writeSession(v: SessionMode) {
  try {
    if (v) localStorage.setItem(SESSION_KEY, v);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export interface Toast {
  id: number;
  tone: "ok" | "held" | "bad" | "neutral";
  title: string;
  detail?: string;
}

interface AppState {
  backend: Backend | null;
  snap: Snapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Runs a backend action, refreshes, and turns a contract refusal into a readable toast. */
  run: <T>(fn: (b: Backend) => Promise<T>, success?: string) => Promise<T | undefined>;
  toast: (t: Omit<Toast, "id">) => void;
  toasts: Toast[];
  connectTestnet: () => Promise<void>;
  leave: () => void;
  route: string;
  go: (path: string) => void;
  // derived
  isOwner: boolean;
  mine: Spender | undefined;
  name: (address: string) => string;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

function currentRoute(): string {
  const h = window.location.hash.replace(/^#/, "");
  return h.startsWith("/") ? h : "/";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [route, setRoute] = useState(currentRoute);
  const seq = useRef(0);

  useEffect(() => {
    const on = () => setRoute(currentRoute());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const go = useCallback((path: string) => {
    window.location.hash = path;
    window.scrollTo({ top: 0 });
  }, []);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq.current;
    setToasts((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), 5200);
  }, []);

  const refresh = useCallback(async () => {
    if (!backend) return;
    setLoading(true);
    try {
      setSnap(await backend.load());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [backend]);

  useEffect(() => {
    setSnap(null);
    if (!backend) return;
    let alive = true;
    (async () => {
      // Agent schedules run in the separate worker process.
      await backend.runAgents();
      if (alive) await refresh();
    })();
    const t = setInterval(async () => {
      if ((await backend.runAgents()) > 0 && alive) {
        toast({ tone: "neutral", title: "An agent ran its schedule", detail: "See Activity for the receipt." });
      }
      if (alive) await refresh();
    }, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [backend, refresh, toast]);

  const run = useCallback(
    async <T,>(fn: (b: Backend) => Promise<T>, success?: string): Promise<T | undefined> => {
      if (!backend) return undefined;
      try {
        const out = await fn(backend);
        if (success) toast({ tone: "ok", title: success });
        await refresh();
        return out;
      } catch (e) {
        if (e instanceof ContractError) toast({ tone: "bad", title: ruleTitle(e.code), detail: ruleDetail(e.code) });
        else toast({ tone: "bad", title: "Something went wrong", detail: e instanceof Error ? e.message : String(e) });
        await refresh();
        return undefined;
      }
    },
    [backend, refresh, toast],
  );

  const connectTestnet = useCallback(async () => {
    const cfg = configFromEnv();
    // The Stellar SDK and wallet code load only when someone connects.
    const { TestnetBackend } = await import("./chain/testnet");
    const b = await TestnetBackend.connect(cfg);
    writeSession("testnet");
    setBackend(b);
    go("/overview");
  }, [go]);

  const leave = useCallback(() => {
    writeSession(null);
    setBackend(null);
    setSnap(null);
    go("/");
  }, [go]);

  // A testnet session needs the wallet again after a reload.
  useEffect(() => {
    if (readSession() === "testnet" && !backend) writeSession(null);
  }, [backend]);

  const value = useMemo<AppState>(() => {
    const isOwner = !!snap && snap.me === snap.account.owner;
    const mine = snap?.spenders.find((s) => s.address === snap.me);
    const name = (a: string) => snap?.names[a] ?? `${a.slice(0, 4)}…${a.slice(-4)}`;
    return { backend, snap, loading, error, refresh, run, toast, toasts, connectTestnet, leave, route, go, isOwner, mine, name };
  }, [backend, snap, loading, error, refresh, run, toast, toasts, connectTestnet, leave, route, go]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
