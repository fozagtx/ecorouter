import { useState } from "react";
import { fmt, parseAmount } from "../lib/money";
import { useApp } from "../state";
import { PageHead } from "../ui/Shell";
import { Addr, Button, Card, Field } from "../ui/kit";

export function Settings() {
  const { snap, isOwner, run, backend, leave, name } = useApp();
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [fundAmount, setFundAmount] = useState("");
  if (!snap || !backend) return null;
  const amount = parseAmount(amt);
  const depositAmount = parseAmount(fundAmount);

  return (
    <>
      <PageHead title="Settings" sub="The account, its owner, and the controls only the owner holds." />
      <div className="grid lg:grid-cols-2 gap-4 sm:gap-6 items-start">
        <Card eyebrow="Account" title={snap.account.name}>
          <dl className="grid grid-cols-[120px_1fr] gap-y-3 text-[13px]">
            <dt className="text-ink-muted">Network</dt>
            <dd>Stellar testnet</dd>
            <dt className="text-ink-muted">Team account</dt>
            <dd><Addr value={snap.account.id} /></dd>
            <dt className="text-ink-muted">Owner</dt>
            <dd>{name(snap.account.owner)} · <Addr value={snap.account.owner} /></dd>
            <dt className="text-ink-muted">Balance</dt>
            <dd className="font-semibold tnum">{fmt(snap.account.balance)} USDC</dd>
            <dt className="text-ink-muted">You</dt>
            <dd>{isOwner ? "Owner" : "Spender"} · <Addr value={snap.me} /></dd>
          </dl>
          <form
            className="mt-4 grid sm:grid-cols-[1fr_auto] gap-2 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (depositAmount !== null) run((b) => b.deposit(depositAmount), `Added ${fmt(depositAmount)} USDC`);
            }}
          >
            <Field label="Amount (USDC)">
              <input className="input tnum" inputMode="decimal" placeholder="0.00" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} />
            </Field>
            <Button type="submit" disabled={depositAmount === null}>Add funds</Button>
          </form>
          <p className="mt-2 text-[12.5px] text-ink-muted">Moves USDC from your Freighter wallet into the team account.</p>
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

        <Card eyebrow="Session" title="Disconnect">
          <p className="text-[13px] text-ink-secondary mb-4">
            Disconnect to stop automatic reconnect and switch the account in Freighter.
          </p>
          <Button onClick={leave}>Disconnect</Button>
          <p className="mt-5 text-[12px] text-ink-muted">Testnet only. The contracts have not been independently audited.</p>
        </Card>
      </div>
    </>
  );
}
