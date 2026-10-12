'use client';

import { useMemo, useState } from 'react';
import { formatUsdc, parseUsdc } from '../../sdk/src/money';
import { validateChallenge } from '../../sdk/src/x402/validate';
import { selectProvider } from '../../sdk/src/router/select';
import type { Candidate } from '../../sdk/src/router/select';
import type { MandateState, PaymentChallenge } from '../../sdk/src/types';

const inputCls =
  'w-full rounded-md border border-[#E3E5EA] bg-white px-2 py-1 text-sm text-[#0B0B0C] font-mono focus:outline-none focus:border-[#3B5BDB]';
const labelCls = 'text-xs font-medium text-[#4A4D57]';
const panelCls =
  'not-prose rounded-xl border border-[#E3E5EA] bg-white px-4 pb-4 pt-2';

interface Row {
  providerId: string;
  priceUsdc: string;
  qualityScore: string;
  successRate: string;
}

export function ChallengeValidator() {
  const [challengeText, setChallengeText] = useState(
    JSON.stringify(
      {
        x402Version: 2,
        scheme: 'exact',
        network: 'stellar:testnet',
        asset: 'USDC',
        amount: '12000',
        payTo: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      },
      null,
      2
    )
  );
  const [asset, setAsset] = useState('USDC');
  const [maxPayment, setMaxPayment] = useState('0.05');
  const [remaining, setRemaining] = useState('5');
  const [expiresInHours, setExpiresInHours] = useState('24');
  const [revoked, setRevoked] = useState(false);
  const [maxSpendUsdc, setMaxSpendUsdc] = useState('0.05');

  const outcome = useMemo((): { amount?: bigint; error?: string } => {
    let challenge: PaymentChallenge;
    try {
      challenge = JSON.parse(challengeText) as PaymentChallenge;
    } catch (e) {
      return {
        error: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    let mandate: MandateState;
    try {
      mandate = {
        asset,
        maxPaymentAtomic: parseUsdc(maxPayment || '0'),
        remainingAtomic: parseUsdc(remaining || '0'),
        expiresAt:
          Math.floor(Date.now() / 1000) +
          Number(expiresInHours || '0') * 3600,
        revoked,
      };
    } catch (e) {
      return {
        error: `Mandate input error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    try {
      const amount = validateChallenge(challenge, mandate, maxSpendUsdc || '0');
      return { amount };
    } catch (e) {
      const err = e as { name?: string; code?: string; message?: string };
      return {
        error: `${err.name ?? 'Error'}${err.code ? ` (${err.code})` : ''}: ${err.message}`,
      };
    }
  }, [challengeText, asset, maxPayment, remaining, expiresInHours, revoked, maxSpendUsdc]);

  return (
    <div className={panelCls}>
      <h3 className="mb-3 text-base font-semibold text-[#0B0B0C]">
        Validate a challenge
      </h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className={labelCls}>PaymentChallenge JSON</div>
          <textarea
            className={`${inputCls} mt-1 h-56`}
            value={challengeText}
            onChange={(e) => setChallengeText(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <div className={labelCls}>Mandate asset</div>
            <input
              className={`${inputCls} mt-1`}
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={labelCls}>maxPayment (USDC)</div>
              <input
                className={`${inputCls} mt-1`}
                value={maxPayment}
                onChange={(e) => setMaxPayment(e.target.value)}
              />
            </div>
            <div>
              <div className={labelCls}>remaining (USDC)</div>
              <input
                className={`${inputCls} mt-1`}
                value={remaining}
                onChange={(e) => setRemaining(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={labelCls}>expiresAt (hours from now)</div>
              <input
                className={`${inputCls} mt-1`}
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(e.target.value)}
              />
            </div>
            <div>
              <div className={labelCls}>policy maxSpendUsdc</div>
              <input
                className={`${inputCls} mt-1`}
                value={maxSpendUsdc}
                onChange={(e) => setMaxSpendUsdc(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-[#0B0B0C]">
            <input
              type="checkbox"
              checked={revoked}
              onChange={(e) => setRevoked(e.target.checked)}
            />
            Mandate revoked
          </label>
        </div>
      </div>
      <div
        className={`mt-4 rounded-md border px-3 py-2 font-mono text-sm ${
          !outcome.error
            ? 'border-[#3B5BDB] bg-[#F5F7FE] text-[#3B5BDB]'
            : 'border-[#E3E5EA] bg-[#F6F7F9] text-[#0B0B0C]'
        }`}
      >
        {outcome.error
          ? outcome.error
          : `Eligible: ${outcome.amount} atomic (${formatUsdc(outcome.amount ?? 0n)} USDC)`}
      </div>
    </div>
  );
}

export function ProviderSelector() {
  const [rows, setRows] = useState<Row[]>([
    { providerId: 'search-alpha', priceUsdc: '0.002', qualityScore: '0.92', successRate: '1' },
    { providerId: 'search-beta', priceUsdc: '0.0015', qualityScore: '0.85', successRate: '0.9' },
  ]);

  const scored = useMemo(() => {
    return rows.map((r) => {
      try {
        const candidate: Candidate = {
          providerId: r.providerId || 'unnamed',
          priceAtomic: parseUsdc(r.priceUsdc || '0'),
          qualityScore: Number(r.qualityScore),
          successRate: Number(r.successRate),
        };
        return {
          ...r,
          economicCost:
            Number(candidate.priceAtomic) /
            (candidate.qualityScore * candidate.successRate),
          valid: Number.isFinite(candidate.qualityScore) && Number.isFinite(candidate.successRate),
        };
      } catch {
        return { ...r, economicCost: NaN, valid: false };
      }
    });
  }, [rows]);

  const winner = useMemo(() => {
    const candidates: Candidate[] = scored
      .filter((s) => s.valid)
      .map((s) => ({
        providerId: s.providerId || 'unnamed',
        priceAtomic: parseUsdc(s.priceUsdc || '0'),
        qualityScore: Number(s.qualityScore),
        successRate: Number(s.successRate),
      }));
    try {
      return selectProvider(candidates).providerId;
    } catch {
      return null;
    }
  }, [scored]);

  const update = (i: number, field: keyof Row, value: string) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  return (
    <div className={panelCls}>
      <h3 className="mb-3 text-base font-semibold text-[#0B0B0C]">
        Select a provider
      </h3>
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2">
          {['providerId', 'price (USDC)', 'qualityScore', 'successRate', ''].map(
            (h) => (
              <div key={h} className={labelCls}>
                {h}
              </div>
            )
          )}
        </div>
        {rows.map((r, i) => (
          <div
            key={i}
            className={`grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-center gap-2 rounded-lg border p-2 ${
              winner && r.providerId === winner
                ? 'border-[#3B5BDB] bg-[#F5F7FE] shadow-[0_0_0_3px_rgba(59,91,219,0.15)]'
                : 'border-[#E3E5EA]'
            }`}
          >
            <input
              className={inputCls}
              value={r.providerId}
              onChange={(e) => update(i, 'providerId', e.target.value)}
            />
            <input
              className={inputCls}
              value={r.priceUsdc}
              onChange={(e) => update(i, 'priceUsdc', e.target.value)}
            />
            <input
              className={inputCls}
              value={r.qualityScore}
              onChange={(e) => update(i, 'qualityScore', e.target.value)}
            />
            <input
              className={inputCls}
              value={r.successRate}
              onChange={(e) => update(i, 'successRate', e.target.value)}
            />
            <button
              className="rounded-md border border-[#E3E5EA] px-2 py-1 text-xs text-[#4A4D57] hover:text-[#0B0B0C] disabled:opacity-40"
              onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              disabled={rows.length <= 1}
            >
              Remove
            </button>
            <div className="col-span-5 text-right font-mono text-xs text-[#4A4D57]">
              {scored[i]?.valid
                ? `economicCost = ${scored[i].economicCost.toFixed(4)}${winner === r.providerId ? '  (winner)' : ''}`
                : 'invalid row'}
            </div>
          </div>
        ))}
      </div>
      <button
        className="mt-3 rounded-md border border-[#E3E5EA] bg-white px-3 py-1 text-sm font-medium text-[#0B0B0C] disabled:opacity-40"
        onClick={() =>
          setRows((prev) => [
            ...prev,
            {
              providerId: `provider-${prev.length + 1}`,
              priceUsdc: '0.001',
              qualityScore: '0.8',
              successRate: '1',
            },
          ])
        }
        disabled={rows.length >= 4}
      >
        Add provider
      </button>
    </div>
  );
}
