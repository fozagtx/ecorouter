import { useState } from "react";
import { fmt, parseAmount, toDecimal } from "../lib/money";
import { CADENCE_SECS, type AgentRule, type Cadence } from "../engine/types";
import { useApp } from "../state";
import { PageHead } from "../ui/Shell";
import { AllowanceLine, Avatar, SpenderStatus, serviceName } from "../ui/domain";
import { Badge, Button, Card, Empty, Field, Icon, Modal, ago } from "../ui/kit";

const CADENCES = Object.keys(CADENCE_SECS) as Cadence[];

function RuleForm({ initial, onDone }: { initial: AgentRule; onDone: () => void }) {
  const { snap, run } = useApp();
  const [r, setR] = useState({ ...initial, amountText: toDecimal(initial.amount) });
  if (!snap) return null;
  const agents = snap.spenders.filter((s) => s.policy.kind === "agent");
  const agent = agents.find((a) => a.address === r.agent);
  const amount = parseAmount(r.amountText);
  const valid = !!agent && !!r.service && amount !== null;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || amount === null) return;
        const { amountText: _t, ...rule } = r;
        await run((b) => b.saveAgentRule({ ...rule, amount }), "Schedule saved");
        onDone();
      }}
    >
      <Field label="Agent">
        <select className="input" value={r.agent} onChange={(e) => setR({ ...r, agent: e.target.value, service: "" })}>
          <option value="">Choose an agent</option>
          {agents.map((a) => (
            <option key={a.address} value={a.address}>{snap.names[a.address] ?? a.policy.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Service" hint="Only services on this agent's list.">
        <select className="input" value={r.service} onChange={(e) => setR({ ...r, service: e.target.value })} disabled={!agent}>
          <option value="">Choose a service</option>
          {agent?.policy.services.map((id) => (
            <option key={id} value={id}>{serviceName(snap, id)}</option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Amount (USDC)" hint={agent ? `Cap: ${fmt(agent.policy.maxPayment)}` : undefined}>
          <input className="input tnum" value={r.amountText} onChange={(e) => setR({ ...r, amountText: e.target.value })} />
        </Field>
        <Field label="Every">
          <select className="input" value={r.every} onChange={(e) => setR({ ...r, every: e.target.value as Cadence })}>
            {CADENCES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Memo">
        <input className="input" maxLength={64} value={r.memo} onChange={(e) => setR({ ...r, memo: e.target.value })} />
      </Field>
      <p className="text-[12px] text-ink-muted">A schedule is a request, not a permission: every run is checked by the contract against the agent's policy, and a refused run stops there.</p>
      <div className="flex justify-end gap-2 pt-2 border-t border-line">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!valid}>Save schedule</Button>
      </div>
    </form>
  );
}

export function Agents() {
  const { snap, isOwner, run, name, backend } = useApp();
  const [editing, setEditing] = useState<AgentRule | null>(null);
  if (!snap || !backend) return null;
  const agents = snap.spenders.filter((s) => s.policy.kind === "agent");

  return (
    <>
      <PageHead
        title="Agents"
        sub="AI agents spend from the same account as your people, each with its own key and policy. They pay on a schedule, and the contract checks every payment they try."
        action={isOwner ? <Button variant="primary" onClick={() => setEditing({ id: `r-${Date.now()}`, agent: agents[0]?.address ?? "", service: "", amount: 0n, every: "day", memo: "", enabled: true })}><Icon name="plus" /> New schedule</Button> : undefined}
      />

      <div className="mb-5 rounded-lg border border-line bg-white p-4 text-[13px] text-ink-secondary">
        <b className="text-ink">On testnet an agent signs with its own key, which never touches this page.</b> Run the worker where the agent lives:
        <pre className="mt-2 rounded bg-surface-soft border border-line p-3 font-mono text-[12px] overflow-x-auto">AGENT_SECRET=S… TEAM_ACCOUNT_ID={snap.account.id} \{"\n"}  node packages/app/worker/agent-worker.mjs --service search --amount 4 --every day</pre>
      </div>

      <div className="flex flex-col gap-4">
        {agents.map((a) => {
          const rules = snap.agentRules.filter((r) => r.agent === a.address);
          const recent = snap.activity.filter((x) => x.spender === a.address && (x.kind === "paid" || x.kind === "refused")).slice(0, 3);
          return (
            <Card key={a.address}>
              <div className="grid lg:grid-cols-[1fr_1.3fr] gap-6">
                <div>
                  <div className="flex items-center gap-3">
                    <Avatar name={name(a.address)} kind="agent" size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-semibold">{name(a.address)}</div>
                      <div className="text-[12px] text-ink-muted">Cap {fmt(a.policy.maxPayment)} · {a.usage.count}/{a.policy.maxPayments} payments</div>
                    </div>
                    <SpenderStatus s={a} now={snap.now} />
                  </div>
                  <div className="mt-4"><AllowanceLine s={a} /></div>
                  <ul className="mt-4 flex flex-col gap-1.5 text-[12.5px]">
                    {recent.map((x) => (
                      <li key={x.id} className="flex items-center gap-2">
                        <Badge tone={x.kind === "paid" ? "ok" : "bad"} className="w-16 justify-center">{x.kind === "paid" ? "Paid" : "Refused"}</Badge>
                        <span className="flex-1 truncate text-ink-secondary">{serviceName(snap, x.service ?? "")}</span>
                        <span className="tnum">{fmt(x.amount ?? 0n)}</span>
                        <span className="text-ink-muted w-16 text-right">{ago(x.at, snap.now)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="eyebrow mb-2">Schedules</div>
                  <ul className="flex flex-col gap-2">
                    {rules.map((r) => {
                      return (
                        <li key={r.id} className="rounded-lg border border-line p-3">
                          <div className="flex items-center gap-2">
                            <Icon name="clock" className="w-4 h-4 text-ink-muted" />
                            <span className="text-[13.5px] flex-1">
                              <b>{fmt(r.amount)}</b> to {serviceName(snap, r.service)} every {r.every}
                            </span>
                            {r.enabled ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}
                          </div>
                          <div className="mt-1 text-[12px] text-ink-muted pl-6">
                            {r.memo || "—"} · {r.lastRun ? `last ran ${ago(r.lastRun, snap.now)}` : "never ran"}
                          </div>
                          {isOwner && (
                            <div className="mt-2.5 pl-6 flex flex-wrap gap-2">
                              <Button size="sm" onClick={() => run((b) => b.saveAgentRule({ ...r, enabled: !r.enabled }))}>{r.enabled ? "Turn off" : "Turn on"}</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
                              <Button size="sm" variant="ghost" onClick={() => run((b) => b.deleteAgentRule(r.id), "Schedule deleted")}>Delete</Button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                    {rules.length === 0 && <li className="text-[13px] text-ink-muted">No schedules. The agent can still pay on its own, inside its policy.</li>}
                  </ul>
                </div>
              </div>
            </Card>
          );
        })}
        {agents.length === 0 && (
          <Card>
            <Empty title="No agents yet">Add a spender of kind “AI agent” on the Spenders page, then give it a schedule here.</Empty>
          </Card>
        )}
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Agent schedule">
        {editing && <RuleForm initial={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  );
}
