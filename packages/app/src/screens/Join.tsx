import { useState } from "react";
import { useApp } from "../state";
import { ago, Button, Card, Field, Logo } from "../ui/kit";

export function Join() {
  const { backend, snap, mine, isOwner, connectTestnet, refresh, toast, go, name } = useApp();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (!backend) {
    return (
      <main className="min-h-screen bg-[#FAFAF7] flex items-center justify-center p-5">
        <Card className="w-full max-w-md p-6 sm:p-8">
          <a href="#/overview" className="inline-flex items-center gap-2 text-[14px] font-semibold">
            <span className="w-8 h-8 rounded-full bg-ink flex items-center justify-center text-white"><Logo /></span>
            EcoRouter
          </a>
          <h1 className="mt-8 text-[30px] font-semibold tracking-[-0.04em]">Join this team</h1>
          <p className="mt-2 text-[14px] text-ink-secondary">Connect Freighter on Stellar testnet to ask the owner to add you.</p>
          <Button variant="primary" className="mt-6 w-full" onClick={() => void connectTestnet().catch((e) => setError(e instanceof Error ? e.message : String(e)))}>
            Connect Freighter
          </Button>
          {error && <p className="mt-3 text-[12.5px] text-destructive">{error}</p>}
          <p className="mt-5 text-[12px] text-ink-muted">Your request is written to the team account on Stellar.</p>
        </Card>
      </main>
    );
  }

  if (!snap) return null;
  const pending = snap.joinRequests.find((request) => request.who === snap.me);

  if (isOwner) {
    return (
      <section className="max-w-xl mx-auto">
        <h1 className="text-[30px] sm:text-[36px] font-semibold tracking-[-0.04em]">Join this team</h1>
        <Card className="mt-6 p-6 sm:p-8">
          <div className="text-[18px] font-medium">You own this account.</div>
          <p className="mt-2 text-[14px] text-ink-secondary">You can manage spenders and join requests from Spenders.</p>
          <Button variant="primary" className="mt-5" onClick={() => go("/spenders")}>Open Spenders</Button>
        </Card>
      </section>
    );
  }

  if (mine) {
    return (
      <section className="max-w-xl mx-auto">
        <h1 className="text-[30px] sm:text-[36px] font-semibold tracking-[-0.04em]">Join this team</h1>
        <Card className="mt-6 p-6 sm:p-8">
          <div className="text-[18px] font-medium">You’re already a spender.</div>
          <p className="mt-2 text-[14px] text-ink-secondary">Your current policy is attached to {name(snap.me)}.</p>
          <Button variant="primary" className="mt-5" onClick={() => go("/overview")}>Open Overview</Button>
        </Card>
      </section>
    );
  }

  if (pending || submitted) {
    const requestAt = pending?.at ?? snap.now;
    return (
      <section className="max-w-xl mx-auto">
        <h1 className="text-[30px] sm:text-[36px] font-semibold tracking-[-0.04em]">Join this team</h1>
        <Card className="mt-6 p-6 sm:p-8">
          <div className="text-[18px] font-medium">Waiting for the owner to set your limits.</div>
          <p className="mt-2 text-[14px] text-ink-secondary">Asked {ago(requestAt, snap.now)}. You’ll be able to spend once the owner adds your policy.</p>
        </Card>
      </section>
    );
  }

  return (
    <section className="max-w-xl mx-auto">
      <div className="eyebrow mb-2">{snap.account.name}</div>
      <h1 className="text-[30px] sm:text-[36px] font-semibold tracking-[-0.04em]">Join this team</h1>
      <p className="mt-2 text-[15px] text-ink-secondary">Ask the owner to add you as a spender. They’ll set your limits before you can pay.</p>
      <Card className="mt-6 p-6 sm:p-8">
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const value = label.trim();
            if (!value || busy) return;
            setBusy(true);
            setError("");
            try {
              await backend.requestJoin(value);
              setSubmitted(true);
              toast({ tone: "ok", title: "Request sent" });
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Your name">
            <input className="input" maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="How the owner will recognize you" />
          </Field>
          {error && <p className="text-[12.5px] text-destructive">{error}</p>}
          <Button type="submit" variant="primary" disabled={!label.trim() || busy}>
            {busy ? "Sending…" : "Ask to join"}
          </Button>
        </form>
      </Card>
    </section>
  );
}
