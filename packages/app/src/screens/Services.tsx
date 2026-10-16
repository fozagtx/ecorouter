import { useApp } from "../state";
import { PageHead } from "../ui/Shell";
import { Addr, Badge, Card } from "../ui/kit";

export function Services() {
  const { snap, mine, name } = useApp();
  if (!snap) return null;
  const listedButUnregistered = Array.from(new Set(snap.spenders.flatMap((s) => s.policy.services))).filter((id) => !snap.services.some((x) => x.id === id));

  return (
    <>
      <PageHead
        title="Services"
        sub="The service registry is the only place a payee comes from. A spender names a service id; the registry resolves it to an address on chain. An id nobody registered resolves to nothing, so there is no one to pay."
      />
      <Card className="overflow-hidden">
        <div className="-m-4 sm:-m-5 overflow-x-auto">
          <table className="w-full text-[13px] min-w-[640px]">
            <thead>
              <tr className="border-b border-line bg-transparent text-left">
                {["Service", "Id", "Pays", "Who may use it", "Status"].map((h) => (
                  <th key={h} className="text-[12.5px] text-ink-muted font-normal px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {snap.services.map((s) => {
                const users = snap.spenders.filter((sp) => sp.policy.services.includes(s.id));
                return (
                  <tr key={s.id}>
                    <td className="px-5 py-3.5 font-medium">
                      {s.name}
                      {mine?.policy.services.includes(s.id) && <Badge tone="accent" className="ml-2">On your list</Badge>}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[12px]">{s.id}</td>
                    <td className="px-5 py-3.5"><Addr value={s.payee} /></td>
                    <td className="px-5 py-3.5 text-ink-secondary">{users.length ? users.map((u) => name(u.address)).join(", ") : "—"}</td>
                    <td className="px-5 py-3.5">{s.suspended ? <Badge tone="bad">Suspended</Badge> : <Badge tone="ok">Active</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {listedButUnregistered.length > 0 && (
        <Card className="mt-4" eyebrow="Listed, never registered" title="These ids are on a spender's list but resolve to nothing">
          <div className="flex flex-wrap gap-2">
            {listedButUnregistered.map((id) => (
              <Badge key={id} tone="bad">{id}</Badge>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-ink-secondary">The spender's list gets past the first check, and the registry refuses at the second. That is the case a typo or a stale list produces, and it fails with no money moved.</p>
        </Card>
      )}

      <div className="mt-4 grid md:grid-cols-3 gap-4 text-[13px]">
        <Card eyebrow="Payout changes">
          A service's current payee can move its own payout address. An approval request records the payee when it is filed, and refuses to settle if it changed.
        </Card>
        <Card eyebrow="Suspension">
          The registry owner can suspend a service. A suspended service resolves to nothing, so in-policy payments to it stop at once.
        </Card>
        <Card eyebrow="Ownership">
          Registry ownership moves in two steps: the owner proposes, the new owner accepts. Nobody can register a service without the owner's signature.
        </Card>
      </div>
    </>
  );
}
