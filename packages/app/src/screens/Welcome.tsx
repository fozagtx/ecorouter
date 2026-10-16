import { useState } from "react";
import { configFromEnv } from "../chain/config";
import { useApp } from "../state";
import { Badge, Button, Icon, Logo } from "../ui/kit";

const SITE = import.meta.env.BASE_URL.replace(/app\/?$/, "");

export function Welcome() {
  const { startSandbox, connectTestnet } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const testnet = configFromEnv();

  return (
    <div className="min-h-screen bg-white">
      <div className="absolute inset-x-0 top-0 h-[420px] grid-bg opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden="true" />
      <div className="relative max-w-5xl mx-auto px-4 sm:px-8">
        <header className="flex items-center justify-between h-16">
          <a href={SITE} className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-[3px] bg-ink flex items-center justify-center text-white"><Logo className="w-4 h-4" /></span>
            <span className="font-semibold text-[15px] tracking-tight">EcoRouter</span>
          </a>
          <a href={`${SITE}docs/`} className="text-[13px] font-mono text-ink-secondary hover:text-ink">Docs</a>
        </header>

        <div className="pt-12 sm:pt-20 pb-10 max-w-2xl">
          <div className="eyebrow mb-4">Team spending on Stellar</div>
          <h1 className="text-[34px] sm:text-[48px] font-semibold tracking-tight leading-[1.05]">
            Room to spend.
            <br />
            Rules you control.
          </h1>
          <p className="mt-5 text-[16px] text-ink-secondary leading-relaxed">
            One USDC account for your people and AI agents. Each spender gets an allowance, a cap per payment and a list of approved services, enforced by a Soroban contract. The agent proposes. Only the contract authorizes.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 pb-12">
          <div className="panel p-6 flex flex-col border-ink/80 border-[1.5px]">
            <div className="flex items-center justify-between">
              <div className="eyebrow">Try it now</div>
              <Badge tone="accent">No wallet</Badge>
            </div>
            <h2 className="mt-3 text-[18px] font-semibold">Open the sandbox team</h2>
            <p className="mt-2 text-[13.5px] text-ink-secondary flex-1">
              A team account with $5,000 in test dollars, two people and two AI agents. It runs the same rules as the contract, in your browser. Switch between the owner and a spender to see both sides.
            </p>
            <Button variant="primary" className="mt-5 w-full" onClick={startSandbox}>
              Open the sandbox <Icon name="arrow" />
            </Button>
          </div>

          <div className="panel p-6 flex flex-col">
            <div className="flex items-center justify-between">
              <div className="eyebrow">Stellar testnet</div>
              <Badge tone="ok">Freighter</Badge>
            </div>
            <h2 className="mt-3 text-[18px] font-semibold">Connect your wallet</h2>
            <p className="mt-2 text-[13.5px] text-ink-secondary flex-1">
              Use the deployed team-account and service-registry contracts on testnet. Every payment is a real Soroban transaction, signed in Freighter, with a receipt on the explorer.
            </p>
            {testnet ? (
              <Button
                className="mt-5 w-full"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setErr(null);
                  try {
                    await connectTestnet();
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Waiting for Freighter…" : "Connect Freighter"}
              </Button>
            ) : (
              <div className="mt-5 rounded border border-dashed border-line-strong p-3 text-[12.5px] text-ink-secondary">
                No testnet contracts are configured in this build. Deploy your own with <code className="font-mono text-[12px]">scripts/deploy-testnet.sh</code>, then rebuild the app.
              </div>
            )}
            {err && <div className="mt-3 text-[12.5px] text-destructive">{err}</div>}
          </div>
        </div>

        <ol className="grid sm:grid-cols-3 gap-px bg-line border border-line rounded-lg overflow-hidden mb-12">
          {[
            ["01", "An allowance for every spender", "Per period, per payment, how often, until when, and to which services."],
            ["02", "Only registered services", "Payments name a service id. The registry decides who is paid, never the spender."],
            ["03", "Over the limit, the owner decides", "A held payment can be sent for approval. Approving and paying are separate steps."],
          ].map(([n, t, d]) => (
            <li key={n} className="bg-white p-5">
              <div className="eyebrow">{n}</div>
              <div className="mt-2 text-[14px] font-semibold">{t}</div>
              <div className="mt-1 text-[13px] text-ink-secondary">{d}</div>
            </li>
          ))}
        </ol>

        <p className="pb-10 text-[12px] text-ink-muted">Testnet only. The contracts have not been independently audited.</p>
      </div>
    </div>
  );
}
