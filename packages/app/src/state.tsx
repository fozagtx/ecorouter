import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ContractError, ruleDetail, ruleTitle } from "./engine/rules";
import type { Backend, Snapshot, Spender } from "./engine/types";
import { configFromEnv } from "./chain/config";

const AUTOCONNECT_KEY = "ecorouter.autoconnect";

function readAutoConnect(): boolean {
  try {
    return localStorage.getItem(AUTOCONNECT_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeAutoConnect(enabled: boolean) {
  try {
    localStorage.setItem(AUTOCONNECT_KEY, enabled ? "on" : "off");
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
  const path = (h.startsWith("/") ? h : "/").split("?")[0];
  return path === "/services" ? "/marketplace" : path;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [route, setRoute] = useState(currentRoute);
  const seq = useRef(0);
  const autoConnectAttempted = useRef(false);
  const manualConnectStarted = useRef(false);

  useEffect(() => {
    const on = () => {
      const hash = window.location.hash.slice(1);
      if (hash.split("?")[0] === "/services") {
        window.location.hash = hash.replace("/services", "/marketplace");
        return;
      }
      setRoute(currentRoute());
    };
    if (window.location.hash.slice(1).split("?")[0] === "/services") {
      window.location.hash = window.location.hash.slice(1).replace("/services", "/marketplace");
    }
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const go = useCallback((path: string) => {
    window.location.hash = path.replace(/^\/services(?=\/|$|\?)/, "/marketplace");
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
    void refresh();
    const t = setInterval(() => {
      if (alive) void refresh();
    }, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [backend, refresh]);

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

  useEffect(() => {
    if (backend || autoConnectAttempted.current || !readAutoConnect()) return;
    autoConnectAttempted.current = true;
    void (async () => {
      try {
        const { getAddress, isAllowed, isConnected } = await import("@stellar/freighter-api");
        const [connection, permission] = await Promise.all([isConnected(), isAllowed()]);
        if (manualConnectStarted.current || !connection.isConnected || connection.error || !permission.isAllowed || permission.error) return;
        const wallet = await getAddress();
        if (manualConnectStarted.current || wallet.error || !wallet.address) return;
        const { TestnetBackend } = await import("./chain/testnet");
        const b = await TestnetBackend.connectAddress(configFromEnv(), wallet.address);
        if (manualConnectStarted.current) return;
        setBackend(b);
        go(route === "/" ? "/overview" : route);
      } catch {
        return;
      }
    })();
  }, [backend, go, route]);

  const connectTestnet = useCallback(async () => {
    manualConnectStarted.current = true;
    const cfg = configFromEnv();
    // The Stellar SDK and wallet code load only when someone connects.
    const { TestnetBackend } = await import("./chain/testnet");
    const b = await TestnetBackend.connect(cfg);
    writeAutoConnect(true);
    setBackend(b);
    const hashRoute = window.location.hash.slice(1);
    go(hashRoute && hashRoute.split("?")[0] !== "/" ? hashRoute : "/overview");
  }, [go]);

  const leave = useCallback(() => {
    writeAutoConnect(false);
    setBackend(null);
    setSnap(null);
    go("/");
  }, [go]);

  const value = useMemo<AppState>(() => {
    const isOwner = !!snap && snap.me === snap.account.owner;
    const mine = snap?.spenders.find((s) => s.address === snap.me);
    const name = (a: string) => snap?.names[a] ?? `${a.slice(0, 4)}…${a.slice(-4)}`;
    return { backend, snap, loading, error, refresh, run, toast, toasts, connectTestnet, leave, route, go, isOwner, mine, name };
  }, [backend, snap, loading, error, refresh, run, toast, toasts, connectTestnet, leave, route, go]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
