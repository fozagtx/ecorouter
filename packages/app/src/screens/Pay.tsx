import { useEffect, useState } from "react";
import { fmt, parseAmount } from "../lib/money";
import { EXCEPTION_ELIGIBLE, Rule, ruleDetail, ruleTitle } from "../engine/rules";
import { servicesNeedingApproval } from "../engine/payment-services";
import type { PayResult, Spender, Verdict } from "../engine/types";
import { useApp } from "../state";
import { PageHead } from "../ui/Shell";
import { CheckList, explorer, serviceName } from "../ui/domain";
import { Badge, Button, Card, Field, Icon } from "../ui/kit";

/** After a pay attempt: what happened, and the next step if it was held. */
export function Outcome({ result, spender, service, amount, memo, via, onAsked }: { result: PayResult; spender: Spender; service: string; amount: bigint; memo: string; via: "app" | "assistant"; onAsked?: () => void }) {
  const { snap, run, go } = useApp();
  const [asked, setAsked] = useState<number | null>(null);
  if (!snap) return null;
  if (result.ok) {
    const link = explorer(result.txHash);
    return (
      <div className="rounded-lg border border-ok/30 bg-ok-soft p-4 rise">
        <div className="flex items-center gap-2 text-ok font-semibold text-[14px]"><Icon name="check" /> Paid {fmt(amount)} to {serviceName(snap, service)}</div>
        <div className="mt-1 text-[12.5px] text-ink-secondary">
          The contract checked the policy, resolved the payee from the registry and moved the money.{" "}
          {link ? <a className="text-accent underline" href={link} target="_blank" rel="noreferrer">View on the explorer</a> : <span className="font-mono">tx {result.txHash?.slice(0, 10)}…</span>}
        </div>
      </div>
    );
  }
  const eligible = EXCEPTION_ELIGIBLE.has(result.rule) && spender.policy.kind === "person";
  return (
    <div className={`rounded-lg border p-4 rise ${eligible ? "border-held-line bg-held-soft" : "border-destructive/30 bg-destructive-soft"}`}>
      <div className={`font-semibold text-[14px] ${eligible ? "text-held" : "text-destructive"}`}>
        {eligible ? "Held by your rules." : "Refused."} No money has left the account.
      </div>
      <div className="mt-1 text-[12.5px] text-ink-secondary">
        <b>{ruleTitle(result.rule)}</b>
        {result.overBy > 0n && result.rule !== Rule.OverFrequency && result.rule !== Rule.ServiceNotAllowed ? ` by ${fmt(result.overBy)}` : ""}. {ruleDetail(result.rule)}
      </div>
      {eligible && asked === null && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="held"
            size="sm"
            onClick={async () => {
              const id = await run((b) => b.requestApproval({ spender: spender.address, service, amount, memo, via }), "Sent to the owner for approval");
              if (id !== undefined) {
                setAsked(id);
                onAsked?.();
              }
            }}
          >
            Ask the owner to approve it
          </Button>
          <span className="text-[12px] text-ink-muted">The request carries the rule that caught it and how far over it went.</span>
        </div>
      )}
      {asked !== null && (
        <div className="mt-3 text-[12.5px]">
          Request <b>#{asked}</b> is on the owner's Approvals screen.{" "}
          <button className="text-accent underline" onClick={() => go("/approvals")}>Open Approvals</button>
        </div>
      )}
      {!eligible && spender.policy.kind === "agent" && <div className="mt-2 text-[12px] text-ink-muted">Agents cannot ask for exceptions; the payment stops here.</div>}
    </div>
  );
}

export function useVerdict(spender: string | undefined, service: string, amount: bigint | null): Verdict | null {
  const { backend, snap } = useApp();
  const [v, setV] = useState<Verdict | null>(null);
  useEffect(() => {
    if (!backend || !spender || !service || amount === null) {
      setV(null);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await backend.check(spender, service, amount);
        if (alive) setV(r);
      } catch {
        if (alive) setV(null);
      }
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [backend, spender, service, amount, snap]);
  return v;
}

export function Pay() {
  const { snap, mine, run } = useApp();
  const [service, setService] = useState("");
  const [amountText, setAmountText] = useState("");
  const [memo, setMemo] = useState("");
  const [result, setResult] = useState<{ r: PayResult; amount: bigint; service: string; memo: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = parseAmount(amountText);
  const verdict = useVerdict(mine?.address, service, amount);

  useEffect(() => {
    if (mine && !service) setService(mine.policy.services[0] ?? "");
  }, [mine, service]);

  if (!snap) return null;
  if (!mine) {
    return (
      <>
        <PageHead title="New payment" />
        <Card><p className="text-[14px] text-ink-secondary">You have no spending policy on this account. Ask the owner to add you as a spender.</p></Card>
      </>
    );
  }

  const approvalServices = mine.policy.kind === "person" ? servicesNeedingApproval(snap.services, mine.policy.services) : [];

  const submit = async () => {
    if (amount === null) return;
    setBusy(true);
    const r = await run((b) => b.pay({ spender: mine.address, service, amount, memo: memo || serviceName(snap, service), via: "app" }));
    setBusy(false);
    if (r) {
      setResult({ r, amount, service, memo: memo || serviceName(snap, service) });
      if (r.ok) {
        setAmountText("");
        setMemo("");
      }
    }
  };

  const ok = verdict?.rule === Rule.Ok;

  return (
    <>
      <PageHead
        title="New payment"
        sub={mine.policy.kind === "person"
          ? "Pick an approved service to pay directly, or choose a registered service under Needs owner approval to ask the owner for an exception. The contract checks your policy before anything moves; there is no recipient field."
          : "Pick one of your approved services and an amount. The contract checks your policy before anything moves; there is no recipient field."}
      />
      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-4 sm:gap-6 items-start">
        <Card eyebrow="Payment" title="Pay a registered service">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field
              label="Service"
              hint={mine.policy.kind === "person"
                ? "Services on your list can be paid directly. Other registered services need owner approval."
                : "Only services on your list appear here. The registry resolves who gets paid."}
            >
              <select className="input" value={service} onChange={(e) => { setService(e.target.value); setResult(null); }}>
                <optgroup label="On your list">
                  {mine.policy.services.map((id) => {
                    const s = snap.services.find((x) => x.id === id);
                    return (
                      <option key={id} value={id}>
                        {s ? s.name : id} {s?.suspended ? "(suspended)" : !s ? "(not registered)" : ""}
                      </option>
                    );
                  })}
                </optgroup>
                {approvalServices.length > 0 && (
                  <optgroup label="Needs owner approval">
                    {approvalServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </optgroup>
                )}
              </select>
            </Field>
            <Field label="Amount (USDC)" hint={`Your cap per payment is ${fmt(mine.policy.maxPayment)}.`}>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-[14px]">$</span>
                <input className="input pl-7 tnum" inputMode="decimal" placeholder="0.00" value={amountText} onChange={(e) => { setAmountText(e.target.value); setResult(null); }} />
              </div>
            </Field>
            <Field label="Memo" hint="Stored with the receipt.">
              <input className="input" maxLength={64} placeholder="What is it for?" value={memo} onChange={(e) => setMemo(e.target.value)} />
            </Field>
            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" variant={ok || !verdict ? "primary" : "secondary"} disabled={busy || amount === null || !service} className="flex-1 sm:flex-none">
                {busy ? "Confirm in Freighter…" : ok ? `Pay ${amount !== null ? fmt(amount) : ""}` : "Submit payment"}
              </Button>
              {verdict && !ok && <Badge tone={EXCEPTION_ELIGIBLE.has(verdict.rule) ? "held" : "bad"}>Will be {EXCEPTION_ELIGIBLE.has(verdict.rule) ? "held" : "refused"}</Badge>}
            </div>
          </form>
          {result && (
            <div className="mt-5">
              <Outcome result={result.r} spender={mine} service={result.service} amount={result.amount} memo={result.memo} via="app" />
            </div>
          )}
        </Card>

        <Card eyebrow="Before you sign" title="What the contract will check" action={verdict ? <Badge tone={ok ? "ok" : EXCEPTION_ELIGIBLE.has(verdict.rule) ? "held" : "bad"}>{ok ? "Would pay" : ruleTitle(verdict.rule)}</Badge> : undefined}>
          {verdict && amount !== null ? (
            <CheckList spender={mine} service={service} amount={amount} verdict={verdict} services={snap.services} balance={snap.account.balance} />
          ) : (
            <p className="text-[13px] text-ink-muted">Enter an amount to see each rule checked in order, with the arithmetic.</p>
          )}
        </Card>
      </div>
    </>
  );
}
