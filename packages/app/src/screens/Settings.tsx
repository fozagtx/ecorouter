import { useState } from "react";
import { fmt, parseAmount, usd } from "../lib/money";
import { SandboxBackend } from "../engine/sandbox";
import { useApp } from "../state";
import { PageHead } from "../ui/Shell";
import { Addr, Button, Card, Field } from "../ui/kit";

export function Settings() {
  const { snap, isOwner, run, backend, refresh, leave, toast, name } = useApp();
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  if (!snap || !backend) return null;
  const sandbox = backend instanceof SandboxBackend ? backend : null;
  const amount = parseAmount(amt);

  return (
    <>
      <PageHead title="Settings" sub="The account, its owner, and the controls only the owner holds." />
      <div className="grid lg:grid-cols-2 gap-4 sm:gap-6 items-start">
        <Card eyebrow="Account" title={snap.account.name}>
          <dl className="grid grid-cols-[120px_1fr] gap-y-3 text-[13px]">
            <dt className="text-ink-muted">Network</dt>
            <dd>{snap.mode === "sandbox" ? "Sandbox (in this browser)" : "Stellar testnet"}</dd>
            <dt className="text-ink-muted">Team account</dt>
            <dd><Addr value={snap.account.id} /></dd>
            <dt className="text-ink-muted">Owner</dt>
            <dd>{name(snap.account.owner)} · <Addr value={snap.account.owner} /></dd>
            <dt className="text-ink-muted">Balance</dt>
            <dd className="font-semibold tnum">{fmt(snap.account.balance)} USDC</dd>
            <dt className="text-ink-muted">You</dt>
            <dd>{isOwner ? "Owner" : "Spender"} · <Addr value={snap.me} /></dd>
          </dl>
          {snap.mode === "testnet" && (
            <p className="mt-4 text-[12.5px] text-ink-secondary">To fund the account, send testnet USDC to the team-account contract address. The contract holds it; nobody else can withdraw it.</p>
          )}
        </Card>

        <Card eyebrow="Owner controls" title="Pause and withdraw">
          {!isOwner && <p className="text-[13px] text-ink-muted mb-4">Only the owner can use these.</p>}
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-line">
            <div className="text-[13px]">
              <div className="font-medium">{snap.account.paused ? "The account is paused" : "Pause the whole account"}</div>
              <div className="text-ink-muted text-[12.5px]">Stops every payment and settlement until you resume.</div>
            </div>
            <Button disabled={!isOwner} variant={snap.account.paused ? "primary" : "danger"} onClick={() => run((b) => b.setAccountPaused(!snap.account.paused), snap.account.paused ? "Account resumed" : "Account paused")}>
              {snap.account.paused ? "Resume" : "Pause"}
            </Button>
          </div>
          <form
            className="pt-4 grid sm:grid-cols-[1fr_120px_auto] gap-2 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (amount !== null) run((b) => b.withdraw(to.trim() || snap.account.owner, amount), `Withdrew ${fmt(amount)}`);
            }}
          >
            <Field label="Withdraw to">
              <input className="input font-mono text-[12px]" placeholder="Owner's address" value={to} onChange={(e) => setTo(e.target.value)} disabled={!isOwner} />
            </Field>
            <Field label="Amount">
              <input className="input tnum" placeholder="0.00" value={amt} onChange={(e) => setAmt(e.target.value)} disabled={!isOwner} />
            </Field>
            <Button type="submit" disabled={!isOwner || amount === null}>Withdraw</Button>
          </form>
        </Card>

        {sandbox && (
          <Card eyebrow="Sandbox" title="Test controls">
            <div className="flex flex-col gap-3 text-[13px]">
              <Row label="Add $1,000 in test dollars" action={<Button size="sm" onClick={() => { sandbox.deposit(usd(1_000)); refresh(); toast({ tone: "ok", title: "Added $1,000 test dollars" }); }}>Add funds</Button>} />
              <Row label="Skip ahead one day (agents run, requests age)" action={<Button size="sm" onClick={async () => { sandbox.advance(86_400); await backend.runAgents(); refresh(); toast({ tone: "neutral", title: "One day later" }); }}>+1 day</Button>} />
              <Row label="Skip to the next period (allowances reset)" action={<Button size="sm" onClick={async () => { sandbox.advance(30 * 86_400); await backend.runAgents(); refresh(); toast({ tone: "neutral", title: "30 days later", detail: "A new period has started." }); }}>+30 days</Button>} />
              <Row label="Start over with the demo team" action={<Button size="sm" variant="danger" onClick={() => { if (confirm("Reset the sandbox to the demo team?")) { sandbox.reset(); refresh(); } }}>Reset</Button>} />
            </div>
          </Card>
        )}

        <Card eyebrow="Session" title={sandbox ? "Leave the sandbox" : "Disconnect"}>
          <p className="text-[13px] text-ink-secondary mb-4">
            {sandbox ? "Your sandbox team stays in this browser until you reset it." : "Your wallet stays connected in Freighter; this only closes the app session."}
          </p>
          <Button onClick={leave}>{sandbox ? "Leave sandbox" : "Disconnect"}</Button>
          <p className="mt-5 text-[12px] text-ink-muted">Testnet only. The contracts have not been independently audited.</p>
        </Card>
      </div>
    </>
  );
}

function Row({ label, action }: { label: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span>{label}</span>
      {action}
    </div>
  );
}
