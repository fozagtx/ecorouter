import { useState } from "react";
import { useApp } from "../state";
import { Button, Logo } from "../ui/kit";

const SITE = import.meta.env.BASE_URL.replace(/app\/?$/, "");

export function Welcome() {
  const { connectTestnet } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const connectFreighter = async () => {
    setBusy(true);
    setErr(null);
    try {
      await connectTestnet();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-[#FCFCF9]">
      <section className="relative isolate min-h-[960px] overflow-hidden bg-[#FAF9F2] lg:aspect-[3/2] lg:min-h-0">
        <img
          src={`${import.meta.env.BASE_URL}hero-hill.jpg`}
          alt=""
          className="absolute inset-x-0 bottom-0 h-[55%] w-full object-cover object-[center_bottom] lg:inset-0 lg:h-full"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[62%] bg-gradient-to-b from-[#FAF9F2] via-[#FAF9F2]/90 to-transparent" />
        <div className="relative z-10 max-w-[1120px] mx-auto px-5 sm:px-10 pt-4">
          <header className="flex items-center justify-between h-14 px-4 sm:px-5 rounded-full bg-white/90 backdrop-blur border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
            <a href={SITE} className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-full bg-ink flex items-center justify-center text-white"><Logo className="w-4 h-4" /></span>
              <span className="font-semibold text-[15px] tracking-tight">EcoRouter</span>
            </a>
            <a href={`${SITE}docs/`} className="text-[14px] text-ink-secondary hover:text-ink">Docs</a>
          </header>

          <div className="pt-7 sm:pt-10 lg:pt-12 pb-10 mx-auto max-w-[760px] text-center">
            <div className="eyebrow mb-3 sm:mb-4">Team spending on Stellar</div>
            <h1 className="text-[39px] sm:text-[48px] lg:text-[56px] font-semibold tracking-[-0.045em] leading-[1.05]">
              Room to spend. Rules you control.
            </h1>
            <p className="mt-4 sm:mt-5 mx-auto max-w-[620px] text-[15px] sm:text-[18px] text-ink-secondary leading-relaxed">
              One USDC account for your people and AI agents. Each spender gets an allowance, a cap per payment and a list of approved services, enforced by a Soroban contract. The agent proposes. Only the contract authorizes.
            </p>
            <div className="mt-5 flex flex-wrap min-[360px]:flex-nowrap items-center justify-center gap-2 sm:gap-3">
              <Button variant="primary" className="pill-cta h-12 gap-2 pl-4 text-[13px] sm:gap-3 sm:pl-5 sm:text-[14px]" disabled={busy} onClick={connectFreighter}>
                <span>{busy ? "Waiting for Freighter…" : "Connect Freighter"}</span>
                <span className="pill-cta-dot h-8 w-8 sm:h-9 sm:w-9" aria-hidden="true"><svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 11L11 5M6 5h5v5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
              </Button>
              <a
                href="https://freighter.app"
                target="_blank"
                rel="noopener"
                className="inline-flex h-12 w-fit items-center justify-center rounded-full border border-white bg-white/70 px-5 text-[13px] font-medium text-ink backdrop-blur transition-colors hover:bg-white sm:text-[14px]"
              >
                Get Freighter
              </a>
            </div>
            {err && <div className="mt-3 text-[12.5px] text-destructive">{err}</div>}
          </div>
        </div>

      </section>

      <section className="bg-[#FCFCF9]">
        <div className="max-w-[1120px] mx-auto px-5 sm:px-10 py-10 sm:py-14">
          <ol className="grid sm:grid-cols-3 gap-4 max-w-[960px] mx-auto">
            {[
              "Install Freighter and switch it to Testnet",
              "Connect. The owner sets allowances; spenders pay within their policy.",
              "Add testnet USDC from Settings, then pay approved services.",
            ].map((step, i) => (
              <li key={step} className="panel rounded-2xl p-6 sm:p-7 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
                <div className="eyebrow">{String(i + 1).padStart(2, "0")}</div>
                <h2 className="mt-3 text-[18px] font-semibold">{step}</h2>
              </li>
            ))}
          </ol>

          <ol className="grid sm:grid-cols-3 gap-6 sm:gap-8 max-w-[960px] mx-auto mt-10 sm:mt-12">
            {[
              ["01", "An allowance for every spender", "Per period, per payment, how often, until when, and to which services."],
              ["02", "Only registered services", "Payments name a service id. The registry decides who is paid, never the spender."],
              ["03", "Over the limit, the owner decides", "A held payment can be sent for approval. Approving and paying are separate steps."],
            ].map(([n, t, d]) => (
              <li key={n} className="min-w-0">
                <div className="text-[13px] text-ink-muted">{n}</div>
                <div className="mt-2 text-[15px] font-semibold tracking-[-0.02em]">{t}</div>
                <div className="mt-1 text-[13px] text-ink-secondary leading-relaxed">{d}</div>
              </li>
            ))}
          </ol>

          <p className="max-w-[960px] mx-auto mt-8 text-[13px] text-ink-muted">Testnet only. The contracts have not been independently audited.</p>
        </div>
      </section>
    </div>
  );
}
