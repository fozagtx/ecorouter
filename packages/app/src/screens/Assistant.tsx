import { useState, type ReactNode } from "react";
import { EXAMPLES, paymentTool, propose, validate, type Proposal, type SchemaResult } from "../assistant/intent";
import { resolve } from "../engine/policy";
import { EXCEPTION_ELIGIBLE, Rule, ruleDetail, ruleTitle } from "../engine/rules";
import type { PayResult, Verdict } from "../engine/types";
import { fmt } from "../lib/money";
import { useApp } from "../state";
import { PageHead } from "../ui/Shell";
import { serviceName } from "../ui/domain";
import { Button, Card, Icon, cx, short } from "../ui/kit";
import { Outcome } from "./Pay";

interface Run {
  sentence: string;
  proposal: Proposal;
  schema: SchemaResult;
  registry: { payee: string } | { rule: number } | null;
  verdict: Verdict | null;
}

type StageState = "pass" | "refuse" | "held" | "info" | "skip";

function Stage({ n, title, state, children, last }: { n: number; title: string; state: StageState; children: ReactNode; last?: boolean }) {
  return (
    <li className="relative pl-11">
      {!last && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-line" aria-hidden="true" />}
      <span
        className={cx(
          "absolute left-0 top-0 w-8 h-8 rounded-full inline-flex items-center justify-center border font-mono text-[12px]",
          state === "pass" && "bg-ok-soft border-ok/30 text-ok",
          state === "refuse" && "bg-destructive text-white border-destructive",
          state === "held" && "bg-held text-white border-held",
          state === "info" && "bg-white border-line-strong text-ink",
          state === "skip" && "bg-surface-muted border-line text-ink-muted",
        )}
      >
        {state === "pass" ? <Icon name="check" className="w-3.5 h-3.5" /> : state === "refuse" || state === "held" ? <Icon name="x" className="w-3.5 h-3.5" /> : n}
      </span>
      <div className={cx("pb-6", state === "skip" && "opacity-50")}>
        <div className="flex items-center gap-2 min-h-8">
          <span className="text-[13.5px] font-semibold">{title}</span>
          {state === "refuse" && <span className="font-mono text-[10.5px] uppercase tracking-wider text-destructive">refused here · no money moved</span>}
          {state === "held" && <span className="font-mono text-[10.5px] uppercase tracking-wider text-held">held here · no money moved</span>}
          {state === "skip" && <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-muted">not reached</span>}
        </div>
        <div className="text-[13px] text-ink-secondary mt-1">{children}</div>
      </div>
    </li>
  );
}

export function Assistant() {
  const { snap, mine, backend, run: runAction } = useApp();
  const [text, setText] = useState("");
  const [r, setR] = useState<Run | null>(null);
  const [paid, setPaid] = useState<PayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTool, setShowTool] = useState(false);
  if (!snap || !backend) return null;
  if (!mine) {
    return (
      <>
        <PageHead title="Assistant" />
        <Card><p className="text-[14px] text-ink-secondary">The assistant drafts payments for spenders. You have no policy on this account.</p></Card>
      </>
    );
  }

  const allowed = mine.policy.services;

  const ask = async (sentence: string) => {
    setText(sentence);
    setPaid(null);
    const proposal = propose(sentence, allowed, snap.services);
    const schema = validate(proposal, allowed, snap.services);
    let registry: Run["registry"] = null;
    let verdict: Verdict | null = null;
    if (schema.ok) {
      registry = resolve(snap.services, schema.draft.service);
      if ("payee" in registry) verdict = await backend.check(mine.address, schema.draft.service, schema.atomic);
    }
    setR({ sentence, proposal, schema, registry, verdict });
  };

  const policyOk = r?.verdict?.rule === Rule.Ok;
  const held = r?.verdict && r.verdict.rule !== Rule.Ok;

  return (
    <>
      <PageHead
        title="Assistant"
        sub="Type one sentence. Code reads the amount, the assistant picks a service from your approved list, and you confirm the draft. It never sees an address, and its output has no field an address could go in."
      />

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4 sm:gap-6 items-start">
        <div className="flex flex-col gap-4 sm:gap-6 min-w-0">
          <Card>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) ask(text.trim());
              }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <input className="input h-11 text-[15px]" placeholder="Top up our inference credits by $120" value={text} onChange={(e) => setText(e.target.value)} aria-label="What should be paid?" />
              <Button variant="primary" className="h-11" type="submit" disabled={!text.trim()}>
                Draft payment
              </Button>
            </form>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => ask(ex)} className="h-7 px-2.5 rounded-full border border-line bg-surface-soft text-[12px] text-ink-secondary hover:border-ink hover:text-ink">
                  {ex}
                </button>
              ))}
            </div>
          </Card>

          {r && (
            <Card eyebrow="From sentence to payment" title="Every stage can refuse; none trusts the one before it">
              <ol className="rise">
                <Stage n={1} title="The sentence" state="info">
                  “{r.sentence}” — typed by {mine.policy.label}. Nothing has been looked at yet.
                </Stage>
                <Stage n={2} title="The assistant proposes" state="info">
                  <p>{r.proposal.because} It proposes; that is all it can do.</p>
                  <pre className="mt-2 rounded border border-line bg-surface-soft p-3 text-[12px] font-mono text-ink overflow-x-auto">
{`propose_payment({
  "service": ${JSON.stringify(r.proposal.service)},
  "amount": ${JSON.stringify(r.proposal.amount)},
  "currency": "USDC",
  "memo": ${JSON.stringify(r.proposal.memo)}
})`}
                  </pre>
                </Stage>
                <Stage n={3} title="The schema" state={r.schema.ok ? "pass" : "refuse"}>
                  {r.schema.ok ? `“${r.schema.draft.service}” is in your enum of approved services and ${fmt(r.schema.atomic)} is a valid amount.` : r.schema.reason}
                </Stage>
                <Stage n={4} title="The registry" state={!r.registry ? "skip" : "payee" in r.registry ? "pass" : "refuse"}>
                  {!r.registry
                    ? "Resolves the service id to the address that gets paid."
                    : "payee" in r.registry
                      ? <>“{r.schema.ok && r.schema.draft.service}” resolves to <span className="font-mono">{short(r.registry.payee, 5)}</span>. The contract resolves it again when it pays.</>
                      : <>{ruleTitle(r.registry.rule)}. {ruleDetail(r.registry.rule)}</>}
                </Stage>
                <Stage n={5} title="The policy, checked by the contract" state={!r.verdict ? "skip" : policyOk ? "pass" : EXCEPTION_ELIGIBLE.has(r.verdict.rule) ? "held" : "refuse"} last>
                  {!r.verdict
                    ? "Allowance, per-payment cap, payments per period, end date and service list."
                    : policyOk
                      ? `Within your rules: ${fmt(r.verdict.allowanceLeft)} left of your allowance before this payment.`
                      : <>{ruleTitle(r.verdict.rule)}{r.verdict.overBy > 0n && r.verdict.rule !== Rule.OverFrequency && r.verdict.rule !== Rule.ServiceNotAllowed ? ` by ${fmt(r.verdict.overBy)}` : ""}. {ruleDetail(r.verdict.rule)}</>}
                </Stage>
              </ol>

              {r.schema.ok && policyOk && !paid && (
                <div className="mt-1 rounded-lg border border-line p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 text-[13.5px]">
                    Pay <b>{fmt(r.schema.atomic)}</b> to <b>{serviceName(snap, r.schema.draft.service)}</b>?
                  </div>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={async () => {
                      if (!r.schema.ok) return;
                      setBusy(true);
                      const res = await runAction((b) => b.pay({ spender: mine.address, service: r.schema.ok ? r.schema.draft.service : "", amount: r.schema.ok ? r.schema.atomic : 0n, memo: r.schema.ok ? r.schema.draft.memo : "", via: "assistant" }));
                      setBusy(false);
                      if (res) setPaid(res);
                    }}
                  >
                    {busy ? (snap.mode === "testnet" ? "Confirm in Freighter…" : "Paying…") : "Confirm and pay"}
                  </Button>
                </div>
              )}
              {r.schema.ok && (paid || held) && (
                <Outcome
                  result={paid ?? { ok: false, rule: r.verdict!.rule, overBy: r.verdict!.overBy }}
                  spender={mine}
                  service={r.schema.draft.service}
                  amount={r.schema.atomic}
                  memo={r.schema.draft.memo}
                  via="assistant"
                />
              )}
              {!r.schema.ok && r.schema.registeredElsewhere && (
                <p className="text-[12.5px] text-ink-muted">This service is registered but not on your list. If you need it once, submit it from New payment and ask the owner to approve an exception.</p>
              )}
            </Card>
          )}
        </div>

        <Card eyebrow="Guardrail" title="The only tool the assistant has">
          <p className="text-[13px] text-ink-secondary">
            Four string fields. The service field is an enum built from <b>your</b> approved list, extra fields are rejected, and there is no address field. A recipient the assistant invents is not filtered out; it cannot be written down.
          </p>
          <button className="mt-3 text-[12.5px] text-accent underline" onClick={() => setShowTool(!showTool)}>
            {showTool ? "Hide" : "Show"} the tool schema
          </button>
          {showTool && (
            <pre className="mt-3 rounded border border-line bg-surface-soft p-3 text-[11.5px] font-mono overflow-x-auto max-h-[420px]">{JSON.stringify(paymentTool(allowed), null, 2)}</pre>
          )}
          <ul className="mt-4 flex flex-col gap-2 text-[12.5px]">
            {allowed.map((id) => {
              const s = snap.services.find((x) => x.id === id);
              return (
                <li key={id} className="flex items-center justify-between gap-2">
                  <span className="font-mono">{id}</span>
                  <span className={cx("text-ink-muted", (!s || s.suspended) && "text-destructive")}>{s ? (s.suspended ? "suspended" : s.name) : "not registered"}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-[12px] text-ink-muted">Drafts run in this browser. Any model plugged in later gets this same tool and nothing more.</p>
        </Card>
      </div>
    </>
  );
}
