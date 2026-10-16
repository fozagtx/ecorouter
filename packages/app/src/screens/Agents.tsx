import { toDecimal } from "../lib/money";
import { useApp } from "../state";
import { configFromEnv } from "../chain/config";
import { PageHead } from "../ui/Shell";
import { ActivityRow, AllowanceLine, KindBadge, SpenderStatus, periodLabel, serviceName } from "../ui/domain";
import { Addr, Badge, Button, Card, Empty, Icon, dateLabel } from "../ui/kit";

export function Agents() {
  const { snap, name, go } = useApp();
  if (!snap) return null;
  const agents = snap.spenders.filter((spender) => spender.policy.kind === "agent");
  const rpcUrl = configFromEnv().rpcUrl;

  return (
    <>
      <PageHead
        title="Agents"
        sub="Agent spenders sign with their own Stellar keys. Their payment limits are enforced by the team-account contract."
      />

      <Card title="Run an agent on Render" eyebrow="External worker">
        <p className="text-[13px] text-ink-secondary">
          One worker runs one agent and one service. Add an agent under Spenders, then deploy the worker with that agent’s secret.
        </p>
        <div className="mt-4 rounded-lg border border-line bg-surface-muted p-3">
          <pre className="overflow-x-auto whitespace-pre text-[12px] leading-6 text-ink-secondary">{[
            "AGENT_SECRET=<agent secret>",
            "AGENT_SERVICE=<service allowed by the policy>",
            "AGENT_AMOUNT=<amount within the per-payment cap>",
            "AGENT_EVERY=day",
            "AGENT_MEMO=<optional>",
            `TEAM_ACCOUNT_ID=${snap.account.id}`,
            `RPC_URL=${rpcUrl}`,
          ].join("\n")}</pre>
        </div>
        <p className="mt-2 text-[12px] text-ink-muted">
          AGENT_EVERY also accepts hour or week. Keep the secret in Render and use the address derived from that same secret.
        </p>
        {agents.length > 0 ? (
          <ul className="mt-4 divide-y divide-line">
            {agents.map((agent) => (
              <li key={agent.address} className="py-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                <span className="font-medium">{name(agent.address)}</span>
                <KindBadge kind="agent" />
                <span className="text-ink-muted">Agent address to add to the worker’s policy:</span>
                <Addr value={agent.address} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[12px] text-ink-muted">No agent spender is configured yet. Add one under Spenders first.</p>
        )}
      </Card>

      <div className="mt-6 grid md:grid-cols-2 gap-4">
        {agents.map((agent) => {
          const activity = snap.activity.filter((entry) => entry.spender === agent.address).slice(0, 5);
          return (
            <Card
              key={agent.address}
              title={name(agent.address)}
              eyebrow="Agent spender"
              action={<SpenderStatus s={agent} now={snap.now} />}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <KindBadge kind="agent" />
                  <div className="mt-1"><Addr value={agent.address} /></div>
                </div>
                {agent.policy.paused && <Badge tone="held">Paused</Badge>}
              </div>
              <div className="mt-4">
                <AllowanceLine s={agent} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-[12.5px]">
                <div><dt className="eyebrow mb-1">Per payment</dt><dd className="font-semibold tnum">{toDecimal(agent.policy.maxPayment)} USDC</dd></div>
                <div><dt className="eyebrow mb-1">Payments</dt><dd className="font-semibold tnum">{agent.usage.count} / {agent.policy.maxPayments} per {periodLabel(agent.policy.period)}</dd></div>
                <div><dt className="eyebrow mb-1">Policy ends</dt><dd className="font-semibold">{dateLabel(agent.policy.expiresAt)}</dd></div>
                <div><dt className="eyebrow mb-1">Approved services</dt><dd className="font-semibold">{agent.policy.services.map((id) => serviceName(snap, id)).join(", ") || "None"}</dd></div>
              </dl>
              <div className="mt-4 border-t border-line pt-3">
                <div className="eyebrow mb-1">Recent activity</div>
                {activity.length > 0 ? (
                  <ul className="divide-y divide-line">
                    {activity.map((entry) => <ActivityRow key={entry.id} a={entry} />)}
                  </ul>
                ) : (
                  <Empty title="No recent activity">Payments and refusals for this agent appear here.</Empty>
                )}
              </div>
            </Card>
          );
        })}
        {agents.length === 0 && (
          <Card>
            <Empty title="No agent spenders yet">
              Add an agent from Spenders before connecting a worker.
            </Empty>
            <div className="flex justify-center -mt-4 pb-2">
              <Button variant="primary" onClick={() => go("/spenders")}>
                Open Spenders <Icon name="arrow" className="w-3.5 h-3.5" />
              </Button>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
