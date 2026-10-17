import { fmt } from "../lib/money";
import { useApp } from "../state";
import { configFromEnv } from "../chain/config";
import { PageHead } from "../ui/Shell";
import { ActivityRow, AllowanceLine, Avatar, KindBadge, SpenderStatus } from "../ui/domain";
import { Addr, Button, Card, Empty } from "../ui/kit";

export function Agents() {
  const { snap, name, go } = useApp();
  if (!snap) return null;
  const agents = snap.spenders.filter((spender) => spender.policy.kind === "agent");
  const cfg = configFromEnv();
  const gatewayUrl = cfg.gatewayUrl;

  return (
    <>
      <PageHead title="Agents" sub="AI agents that spend from this account. Each has its own key and limits." />

      {agents.length === 0 ? (
        <Card className="mb-5">
          <Empty title="No agent spenders yet">Add an agent spender and set its limits before it can call paid services.</Empty>
          <div className="flex justify-center -mt-4 pb-2">
            <Button variant="primary" onClick={() => go("/spenders?kind=agent")}>Add an agent</Button>
          </div>
        </Card>
      ) : (
        <Card className="mb-5 p-0 overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-[800px] w-full text-left text-[12.5px]">
              <thead className="bg-surface-soft text-[11px] uppercase tracking-wide text-ink-muted">
                <tr>{["Name", "Address", "Allowance used", "Cap", "Payments this period", "Status"].map((title) => <th key={title} className="px-4 py-3 font-medium">{title}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {agents.map((agent) => (
                    <tr key={agent.address}>
                      <td className="px-4 py-4"><div className="flex items-center gap-2.5"><Avatar name={name(agent.address)} kind="agent" size={32} /><div><div className="font-semibold">{name(agent.address)}</div><KindBadge kind="agent" /></div></div></td>
                      <td className="px-4 py-4 font-mono text-[11px]"><Addr value={agent.address} /></td>
                      <td className="px-4 py-4"><AllowanceLine s={agent} compact /></td>
                      <td className="px-4 py-4 font-semibold tnum">{fmt(agent.policy.maxPayment)}</td>
                      <td className="px-4 py-4 tnum">{agent.usage.count} / {agent.policy.maxPayments}</td>
                      <td className="px-4 py-4"><SpenderStatus s={agent} now={snap.now} /></td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid md:hidden gap-3 p-4">
            {agents.map((agent) => (
                <div key={agent.address} className="rounded-lg border border-line p-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={name(agent.address)} kind="agent" size={36} />
                    <div className="min-w-0 flex-1"><div className="font-semibold">{name(agent.address)}</div><div className="mt-1"><SpenderStatus s={agent} now={snap.now} /></div><div className="mt-2 font-mono text-[11px]"><Addr value={agent.address} /></div></div>
                  </div>
                  <div className="mt-4"><AllowanceLine s={agent} /></div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
                    <div><div className="eyebrow mb-1">Per-payment cap</div><b className="tnum">{fmt(agent.policy.maxPayment)}</b></div>
                    <div><div className="eyebrow mb-1">Payments this period</div><b className="tnum">{agent.usage.count} / {agent.policy.maxPayments}</b></div>
                  </div>
                </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Connect an agent">
        <ol className="grid md:grid-cols-3 gap-4">
          <li className="rounded-lg border border-line p-4">
            <span className="inline-flex w-7 h-7 items-center justify-center rounded-full bg-surface-muted text-[12px] font-semibold">1</span>
            <h3 className="mt-3 font-medium text-[14px]">Add it as a spender</h3>
            <p className="mt-1 text-[12.5px] text-ink-secondary">Give the agent its own Stellar key, then set its allowance, cap, and allowed services.</p>
            <Button size="sm" className="mt-3" onClick={() => go("/spenders?kind=agent")}>Add an agent</Button>
          </li>
          <li className="rounded-lg border border-line p-4">
            <span className="inline-flex w-7 h-7 items-center justify-center rounded-full bg-surface-muted text-[12px] font-semibold">2</span>
            <h3 className="mt-3 font-medium text-[14px]">Install the SDK</h3>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-muted p-3 text-[12px]">npm i ecorouter</pre>
          </li>
          <li className="rounded-lg border border-line p-4 md:col-span-1">
            <span className="inline-flex w-7 h-7 items-center justify-center rounded-full bg-surface-muted text-[12px] font-semibold">3</span>
            <h3 className="mt-3 font-medium text-[14px]">Fetch or call a service</h3>
            <pre className="mt-3 overflow-x-auto whitespace-pre rounded-lg bg-surface-muted p-3 text-[11px] leading-5">{[
              'import { TeamAgent } from "ecorouter";',
              "",
              "const agent = new TeamAgent({",
              "  secret: process.env.AGENT_SECRET,",
              "});",
              "",
              "const { response, payment } =",
              "  await agent.fetch(process.env.AGENT_URL);",
              "const result = await agent.pay({",
              '  service: "nebius_llm", amount: "0.01",',
              "});",
            ].join("\n")}</pre>
            {gatewayUrl ? <p className="mt-2 break-all text-[11px] text-ink-muted">Gateway: {gatewayUrl}</p> : <p className="mt-2 text-[11px] text-ink-muted">Gateway not deployed yet.</p>}
          </li>
        </ol>
      </Card>

      <details className="mt-5 rounded-xl border border-line bg-white px-4 sm:px-5 py-4">
        <summary className="cursor-pointer text-[13px] font-medium">Run it on Render (advanced)</summary>
        <div className="mt-4 grid lg:grid-cols-2 gap-4">
          <div>
            <p className="text-[12.5px] text-ink-secondary">Set these environment variables on the worker. Keep the agent secret private and use the address derived from that same secret.</p>
            <pre className="mt-3 overflow-x-auto whitespace-pre rounded-lg bg-surface-muted p-3 text-[12px] leading-6 text-ink-secondary">{[
              "AGENT_SECRET=<agent secret>",
              "AGENT_SERVICE=<service allowed by its policy>",
              "AGENT_AMOUNT=<amount within its cap>",
              "AGENT_EVERY=day",
              "AGENT_MEMO=<optional>",
              `TEAM_ACCOUNT_ID=${snap.account.id}`,
              `RPC_URL=${cfg.rpcUrl}`,
            ].join("\n")}</pre>
            <p className="mt-2 text-[11.5px] text-ink-muted">AGENT_EVERY also accepts hour or week.</p>
          </div>
          <div className="rounded-lg bg-surface-soft p-4">
            <div className="eyebrow mb-2">Agent addresses on this account</div>
            {agents.length ? <ul className="divide-y divide-line">{agents.map((agent) => <li key={agent.address} className="py-2 first:pt-0 last:pb-0"><div className="font-medium text-[13px]">{name(agent.address)}</div><Addr value={agent.address} /></li>)}</ul> : <p className="text-[12.5px] text-ink-muted">No agent spenders are configured yet.</p>}
          </div>
        </div>
      </details>

      {agents.some((agent) => snap.activity.some((activity) => activity.spender === agent.address)) && (
        <Card title="Recent agent activity" className="mt-5">
          <ul className="divide-y divide-line">{snap.activity.filter((activity) => activity.spender && agents.some((agent) => agent.address === activity.spender)).slice(0, 5).map((activity) => <ActivityRow key={activity.id} a={activity} />)}</ul>
        </Card>
      )}
    </>
  );
}
