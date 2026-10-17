import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AppProvider, useApp } from "./state";
import { Shell } from "./ui/Shell";
import { Welcome } from "./screens/Welcome";
import { Overview } from "./screens/Overview";
import { Pay } from "./screens/Pay";
import { Assistant } from "./screens/Assistant";
import { Approvals } from "./screens/Approvals";
import { Spenders } from "./screens/Spenders";
import { Agents } from "./screens/Agents";
import { Marketplace } from "./screens/Marketplace";
import { Join } from "./screens/Join";
import { Activity } from "./screens/Activity";
import { Settings } from "./screens/Settings";
import { Button } from "./ui/kit";

const ROUTES: Record<string, () => React.ReactElement | null> = {
  "/overview": Overview,
  "/pay": Pay,
  "/assistant": Assistant,
  "/approvals": Approvals,
  "/spenders": Spenders,
  "/agents": Agents,
  "/marketplace": Marketplace,
  "/join": Join,
  "/activity": Activity,
  "/settings": Settings,
};

function App() {
  const { backend, snap, route, error, refresh, leave } = useApp();
  if (!backend) return route === "/join" ? <Join /> : <Welcome />;
  if (!snap) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        {error ? (
          <div className="panel p-6 max-w-md text-center">
            <div className="font-semibold">Could not read the account</div>
            <p className="mt-2 text-[13px] text-ink-secondary break-words">{error}</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={refresh}>Try again</Button>
              <Button variant="ghost" onClick={leave}>Back</Button>
            </div>
          </div>
        ) : (
          <div className="font-mono text-[12px] text-ink-muted">Reading the account…</div>
        )}
      </div>
    );
  }
  const Screen = ROUTES[route] ?? Overview;
  return (
    <Shell>
      <Screen />
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
