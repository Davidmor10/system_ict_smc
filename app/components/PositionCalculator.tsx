'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import type { LivePrices } from '../hooks/useLivePrices';

// ─── CME contract specifications (official point values) ────────────────────
type AssetKey = 'ES' | 'NQ';

const SPEC: Record<AssetKey, {
  label: string; std: string; micro: string; ptStd: number; ptMicro: number;
}> = {
  ES: { label: 'ES1! · S&P 500', std: 'ES', micro: 'MES', ptStd: 50, ptMicro: 5 },
  NQ: { label: 'NQ1! · Nasdaq',  std: 'NQ', micro: 'MNQ', ptStd: 20, ptMicro: 2 },
};

const RISK_PRESETS = [0.25, 0.5, 1, 2];

// Institutional-gold hero metric: heavy weight + soft glow.
const GOLD_GLOW = 'text-[#d4af37] [text-shadow:0_0_22px_rgba(212,175,55,0.5)]';

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(
    Number.isFinite(n) ? n : 0,
  );
const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export default function PositionCalculator({ live }: { live: LivePrices }) {
  const { t, lang } = useLanguage();
  const rtl = lang === 'he';
  const align = rtl ? 'text-right' : 'text-left';

  const [asset, setAsset]           = useState<AssetKey>('ES');
  const [balance, setBalance]       = useState('50000');
  const [risk, setRisk]             = useState('1');
  const [stop, setStop]             = useState('10');
  const [manualEntry, setManualEntry] = useState<string | null>(null); // null ⇒ live-synced

  // Re-sync the entry field to the live feed whenever the asset changes.
  useEffect(() => { setManualEntry(null); }, [asset]);

  const spec      = SPEC[asset];
  const livePrice = asset === 'ES' ? live.es.price : live.nq.price;
  const synced    = manualEntry === null;
  const entryVal  = synced ? (livePrice > 0 ? livePrice.toFixed(2) : '') : manualEntry;
  const entry     = synced ? livePrice : num(manualEntry ?? '');

  // ── Institutional math engine ─────────────────────────────────────────────
  const balanceNum     = num(balance);
  const riskNum        = num(risk);
  const stopNum        = num(stop);
  const cashAtRisk     = balanceNum * (riskNum / 100);
  const riskPerStd     = stopNum * spec.ptStd;
  const riskPerMicro   = stopNum * spec.ptMicro;
  const stdContracts   = riskPerStd   > 0 ? Math.floor(cashAtRisk / riskPerStd)   : 0;
  const microContracts = riskPerMicro > 0 ? Math.floor(cashAtRisk / riskPerMicro) : 0;
  const stopLevel      = entry > 0 && stopNum > 0 ? entry - stopNum : 0;

  // Actual risk taken once contracts are rounded down (≤ the risk budget).
  const actualStd      = stdContracts   * riskPerStd;
  const actualMicro    = microContracts * riskPerMicro;
  const pctStd         = balanceNum > 0 ? (actualStd   / balanceNum) * 100 : 0;
  const pctMicro       = balanceNum > 0 ? (actualMicro / balanceNum) * 100 : 0;
  const actualLine = (dollars: number, pct: number) => `${usd(dollars)} (${pct.toFixed(2)}%)`;

  const inputCls =
    'w-full bg-[#1c1c1e] border border-[#2a2a2d] rounded-sm px-3 py-2.5 text-base font-bold font-mono text-white ' +
    'tabular-nums tracking-wide outline-none transition-colors duration-300 focus:border-[#d4af37]/60 ' +
    'placeholder:text-[#52525b] placeholder:font-medium';
  const labelCls = `text-sm font-bold font-mono text-white/70 uppercase tracking-[0.18em] block mb-2 ${align}`;

  return (
    <section
      dir={rtl ? 'rtl' : 'ltr'}
      className="w-full bg-[#000000] border-t border-[#1c1c1e] px-6 py-12"
    >
      <div className="mx-auto max-w-5xl">

        {/* Header */}
        <div className={`mb-9 ${align}`}>
          <h2 className="font-serif text-3xl font-bold tracking-[0.03em] text-white leading-none">{t('calc_title')}</h2>
          <p className="text-sm font-bold font-mono text-white/55 uppercase tracking-[0.2em] mt-3">{t('calc_subtitle')}</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-px bg-[#1c1c1e] border border-[#1c1c1e] rounded-sm overflow-hidden">

          {/* ── Inputs ───────────────────────────────────────────────────── */}
          <div className="bg-[#000000] p-6 flex flex-col gap-5">

            {/* Asset */}
            <div>
              <span className={labelCls}>{t('calc_asset')}</span>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(SPEC) as AssetKey[]).map(k => (
                  <button
                    key={k}
                    onClick={() => setAsset(k)}
                    className={`py-2.5 rounded-sm text-sm font-bold font-mono tracking-[0.15em] uppercase transition-all duration-300 border ${
                      asset === k
                        ? 'bg-white text-black border-white'
                        : 'bg-[#1c1c1e] text-white/60 border-[#2a2a2d] hover:text-white'
                    }`}
                  >
                    {SPEC[k].std} · {k === 'ES' ? 'S&P' : 'NDX'}
                  </button>
                ))}
              </div>
            </div>

            {/* Account balance */}
            <div>
              <span className={labelCls}>{t('calc_balance')}</span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base font-bold font-mono text-white/55 pointer-events-none">$</span>
                <input
                  dir="ltr"
                  inputMode="decimal"
                  value={balance}
                  onChange={e => setBalance(e.target.value)}
                  className={inputCls + ' pl-8'}
                  placeholder="50000"
                />
              </div>
            </div>

            {/* Risk % */}
            <div>
              <span className={labelCls}>{t('calc_risk')}</span>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {RISK_PRESETS.map(p => (
                  <button
                    key={p}
                    onClick={() => setRisk(String(p))}
                    className={`py-2 rounded-sm text-sm font-bold font-mono tabular-nums transition-all duration-300 border ${
                      num(risk) === p
                        ? 'bg-white text-black border-white'
                        : 'bg-[#1c1c1e] text-white/60 border-[#2a2a2d] hover:text-white'
                    }`}
                  >
                    {p}%
                  </button>
                ))}
              </div>
              <input
                dir="ltr"
                inputMode="decimal"
                value={risk}
                onChange={e => setRisk(e.target.value)}
                className={inputCls}
                placeholder="1"
              />
            </div>

            {/* Stop loss */}
            <div>
              <span className={labelCls}>{t('calc_stop')}</span>
              <input
                dir="ltr"
                inputMode="decimal"
                value={stop}
                onChange={e => setStop(e.target.value)}
                className={inputCls}
                placeholder="10"
              />
            </div>

            {/* Entry price (live-synced) */}
            <div>
              <div className={`flex items-center justify-between mb-2 ${rtl ? 'flex-row-reverse' : ''}`}>
                <span className="text-sm font-bold font-mono text-white/70 uppercase tracking-[0.18em]">{t('calc_entry')}</span>
                <button
                  onClick={() => setManualEntry(null)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm border text-xs font-bold font-mono uppercase tracking-[0.18em] transition-all duration-300 ${
                    synced
                      ? 'border-[#d4af37]/50 text-[#d4af37]'
                      : 'border-[#2a2a2d] text-white/50 hover:text-[#d4af37] hover:border-[#d4af37]/40'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${synced && livePrice > 0 ? 'bg-[#d4af37] animate-pulse' : 'bg-white/40'}`} />
                  {t('calc_sync')}
                </button>
              </div>
              <input
                dir="ltr"
                inputMode="decimal"
                value={entryVal}
                onChange={e => setManualEntry(e.target.value)}
                className={inputCls}
                placeholder="—"
              />
              {!synced && (
                <span className={`text-sm font-semibold font-mono text-white/50 tracking-wide mt-2 block ${align}`}>{t('calc_manual')}</span>
              )}
            </div>
          </div>

          {/* ── Results ──────────────────────────────────────────────────── */}
          <div className="bg-[#0d0d0f] p-6 flex flex-col">
            <span className={labelCls}>{t('calc_results')}</span>

            {/* Cash at risk — hero metric */}
            <div className="mb-6">
              <span className="text-sm font-bold font-mono text-white/70 uppercase tracking-[0.18em] block mb-1.5">{t('calc_cash_risk')}</span>
              <span className={`text-5xl font-black font-mono tabular-nums tracking-tight ${GOLD_GLOW}`}>{usd(cashAtRisk)}</span>
            </div>

            {/* Contract counts — hero metrics, with actual risk beneath each */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-[#000000] border border-[#1c1c1e] rounded-sm p-4">
                <span className="text-xs font-bold font-mono text-white/60 uppercase tracking-[0.16em] block mb-2">
                  {t('calc_std')} · {spec.std}
                </span>
                <span className={`text-4xl font-black font-mono tabular-nums ${GOLD_GLOW}`}>{stdContracts}</span>
                <span className="block text-xs font-bold font-mono text-white/55 mt-2.5 leading-snug">
                  {t('calc_actual_risk')}:{' '}
                  <span dir="ltr" className="text-[#d4af37] tabular-nums">{actualLine(actualStd, pctStd)}</span>
                </span>
              </div>
              <div className="bg-[#000000] border border-[#1c1c1e] rounded-sm p-4">
                <span className="text-xs font-bold font-mono text-white/60 uppercase tracking-[0.16em] block mb-2">
                  {t('calc_micro')} · {spec.micro}
                </span>
                <span className={`text-4xl font-black font-mono tabular-nums ${GOLD_GLOW}`}>{microContracts}</span>
                <span className="block text-xs font-bold font-mono text-white/55 mt-2.5 leading-snug">
                  {t('calc_actual_risk')}:{' '}
                  <span dir="ltr" className="text-[#d4af37] tabular-nums">{actualLine(actualMicro, pctMicro)}</span>
                </span>
              </div>
            </div>

            {/* Breakdown */}
            <div className="flex flex-col gap-1 mt-auto">
              {[
                { label: `${t('calc_risk_per_std')} · ${spec.std}`,   val: usd(riskPerStd) },
                { label: `${t('calc_risk_per_micro')} · ${spec.micro}`, val: usd(riskPerMicro) },
                { label: t('calc_pt_value'), val: `$${spec.ptStd} / $${spec.ptMicro}` },
                { label: t('calc_stop_level'), val: stopLevel > 0 ? stopLevel.toFixed(2) : '—' },
              ].map(r => (
                <div key={r.label} className="flex items-center justify-between py-2.5 border-b border-[#1c1c1e] last:border-0">
                  <span className="text-sm font-bold font-mono text-white/70 uppercase tracking-wider">{r.label}</span>
                  <span className="text-base font-bold font-mono text-white tabular-nums" dir="ltr">{r.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <span className={`text-xs font-medium font-mono text-white/40 tracking-wider mt-5 block ${align}`}>{t('calc_spec_note')}</span>
      </div>
    </section>
  );
}
