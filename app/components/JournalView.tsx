'use client';

import { useState, useEffect } from 'react';
import { useMarketStream } from '../hooks/useMarketStream';
import type { Bias, SessionName, SMTState, ConfluenceState } from '../hooks/useMarketStream';

// ─── Types ───────────────────────────────────────────────────────────────────

type TradeResult = 'OPEN' | 'WIN' | 'LOSS' | 'BE';

interface TradeEntry {
  id: number;
  time: string;
  symbol: 'ES' | 'NQ';
  direction: 'LONG' | 'SHORT';
  entry: number;
  stop: number;
  target: number;
  session: string;
  bias: Bias;
  result: TradeResult;
  notes: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Institutional-gold hero metric: heavy weight + soft glow (matches calculator).
const GOLD_GLOW = 'text-[#d4af37] [text-shadow:0_0_22px_rgba(212,175,55,0.5)]';

// CME standard point values — used for realized PnL (1 standard contract).
const PT_VALUE: Record<TradeEntry['symbol'], number> = { ES: 50, NQ: 20 };

const SESSION_LABELS: Record<SessionName, string> = {
  ASIA:  'Asia · 00:00–08:00 ET',
  LONDON: 'London · 09:00–12:00 ET',
  NY_AM:  'NY AM · 16:00–18:00 ET',
  NY_PM:  'NY PM · 20:00–23:59 ET',
};

function getCurrentSession(): SessionName | null {
  const h = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hour12: false,
    }).format(new Date()),
    10,
  );
  if (h >= 0  && h < 8)  return 'ASIA';
  if (h >= 9  && h < 12) return 'LONDON';
  if (h >= 16 && h < 18) return 'NY_AM';
  if (h >= 20)           return 'NY_PM';
  return null;
}

// Realized PnL in USD for one standard contract; null for still-open trades.
function tradePnL(t: TradeEntry): number | null {
  if (t.result === 'OPEN') return null;
  if (t.result === 'BE')   return 0;
  const dir  = t.direction === 'LONG' ? 1 : -1;
  const exit = t.result === 'WIN' ? t.target : t.stop;
  return (exit - t.entry) * dir * PT_VALUE[t.symbol];
}

function resultCls(r: TradeResult): string {
  if (r === 'WIN')  return 'text-bullish';
  if (r === 'LOSS') return 'text-bearish';
  if (r === 'BE')   return 'text-[#d4af37]';
  return 'text-white/50';
}

function biasCls(b: Bias): string {
  return b === 'BULLISH' ? 'text-bullish' : b === 'BEARISH' ? 'text-bearish' : 'text-white/60';
}

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, signDisplay: 'always' })
    .format(Number.isFinite(n) ? n : 0);

// ─── Performance stats bar ─────────────────────────────────────────────────────

function StatsBar({ trades }: { trades: TradeEntry[] }) {
  const closed  = trades.filter(t => t.result !== 'OPEN');
  const wins    = closed.filter(t => t.result === 'WIN').length;
  const losses  = closed.filter(t => t.result === 'LOSS').length;
  const decided = wins + losses;
  const winRate = decided > 0 ? (wins / decided) * 100 : 0;

  const pnls      = closed.map(tradePnL).filter((n): n is number => n !== null);
  const grossWin  = pnls.filter(n => n > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter(n => n < 0).reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const totalPnL  = pnls.reduce((a, b) => a + b, 0);

  const heroes: { label: string; val: string }[] = [
    { label: 'Win Rate',      val: `${winRate.toFixed(1)}%` },
    { label: 'Profit Factor', val: profitFactor === Infinity ? '∞' : profitFactor.toFixed(2) },
    { label: 'Total PnL',     val: usd(totalPnL) },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#1c1c1e] border-b border-[#1c1c1e] shrink-0">
      {heroes.map(s => (
        <div key={s.label} className="bg-[#000000] px-5 py-4 flex flex-col gap-1.5">
          <span className="text-sm font-bold font-mono text-white/60 uppercase tracking-[0.18em]">{s.label}</span>
          <span className={`text-3xl font-black font-mono tabular-nums ${GOLD_GLOW}`}>{s.val}</span>
        </div>
      ))}
      <div className="bg-[#000000] px-5 py-4 flex flex-col gap-1.5">
        <span className="text-sm font-bold font-mono text-white/60 uppercase tracking-[0.18em]">Trades</span>
        <span className="text-3xl font-black font-mono tabular-nums text-white">
          {trades.length}
          <span className="text-base font-bold text-white/50 ml-2">{wins}W · {losses}L</span>
        </span>
      </div>
    </div>
  );
}

// ─── Live Signal sidebar ──────────────────────────────────────────────────────

function SignalSidebar({
  smt, confluence,
  esPrice, nqPrice,
  esBias, nqBias,
  esSessionHigh, esSessionLow,
  nqSessionHigh, nqSessionLow,
  esHighSwept, esLowSwept,
  nqHighSwept, nqLowSwept,
  sessionLabel,
}: {
  smt: SMTState; confluence: ConfluenceState;
  esPrice: number; nqPrice: number;
  esBias: Bias; nqBias: Bias;
  esSessionHigh: number | null; esSessionLow: number | null;
  nqSessionHigh: number | null; nqSessionLow: number | null;
  esHighSwept: boolean; esLowSwept: boolean;
  nqHighSwept: boolean; nqLowSwept: boolean;
  sessionLabel: string;
}) {
  return (
    <aside className="w-72 shrink-0 border-r border-[#1c1c1e] flex flex-col gap-5 px-5 py-5 overflow-y-auto bg-[#000000]">

      {/* Bias snapshot */}
      <div className="flex flex-col gap-2">
        <span className="text-base font-bold font-mono uppercase tracking-[0.14em] text-white border-b border-[#1c1c1e] pb-2">
          Live Bias
        </span>
        {([['ES', esBias, esPrice], ['NQ', nqBias, nqPrice]] as [string, Bias, number][]).map(([sym, b, p]) => (
          <div key={sym} className="flex items-center justify-between py-1.5 border-b border-[#1c1c1e] last:border-0">
            <span className="text-sm font-bold font-mono text-white/70 uppercase tracking-wider w-7 shrink-0">{sym}</span>
            <span className={`text-base font-bold font-mono ${biasCls(b as Bias)}`}>
              {b === 'BULLISH' ? '▲' : b === 'BEARISH' ? '▼' : '◈'} {b}
            </span>
            <span className="text-base font-bold font-mono text-white tabular-nums">{(p as number).toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Confluence checklist */}
      <div className={`flex flex-col gap-2 rounded border p-4 transition-all duration-700 ease-in-out ${confluence.active ? 'border-[#d4af37]/35 bg-[#d4af37]/5' : 'border-[#1c1c1e]'}`}>
        <div className="flex items-center justify-between">
          <span className="text-base font-bold font-mono uppercase tracking-[0.14em] text-white">Confluence</span>
          <span className={`text-sm font-bold font-mono ${confluence.score === 3 ? 'text-[#d4af37]' : confluence.score === 2 ? 'text-[#d4af37]/70' : 'text-white/50'}`}>
            {confluence.score}/3
          </span>
        </div>
        {confluence.active && (
          <span className="text-sm font-bold font-mono text-[#d4af37] tracking-[0.15em]">◈ ENTRY SIGNAL</span>
        )}
        {[
          { label: 'HTF Zone Aligned', on: confluence.htfZoneAligned },
          { label: 'Liquidity Sweep',  on: confluence.liquiditySweep },
          { label: 'SMT Divergence',   on: confluence.smtDivergence  },
        ].map(r => (
          <div key={r.label} className="flex items-center gap-2">
            <span className={`text-sm font-bold transition-all duration-700 ease-in-out ${r.on ? 'text-[#d4af37]' : 'text-white/25'}`}>{r.on ? '✓' : '○'}</span>
            <span className={`text-sm font-bold font-mono tracking-wider transition-all duration-700 ease-in-out ${r.on ? 'text-white' : 'text-white/50'}`}>{r.label}</span>
          </div>
        ))}
      </div>

      {/* SMT alert */}
      {smt.active && smt.type && (
        <div className="rounded border border-[#d4af37]/25 bg-[#d4af37]/5 p-4 flex flex-col gap-2">
          <span className="text-base font-bold font-mono uppercase tracking-[0.14em] text-white">SMT Divergence</span>
          <span className={`text-base font-bold font-mono ${smt.type === 'BULLISH_SMT' ? 'text-bullish' : 'text-bearish'}`}>
            {smt.type.replace('_', ' ')}
          </span>
          <p className="text-sm font-bold font-mono text-[#c0c0c0] leading-relaxed tracking-wide">
            {smt.type === 'BULLISH_SMT'
              ? 'ES swept SSL; NQ held. Watch for bullish reversal.'
              : 'ES swept BSL; NQ failed to confirm. Bearish div.'}
          </p>
        </div>
      )}

      {/* Active session liq */}
      <div className="flex flex-col gap-2">
        <span className="text-base font-bold font-mono uppercase tracking-[0.14em] text-white border-b border-[#1c1c1e] pb-2">
          {sessionLabel}
        </span>
        {esSessionHigh !== null ? (
          <>
            <div className="flex justify-between text-sm font-bold font-mono">
              <span className="text-white/70">ES BSL</span>
              <span className={`tabular-nums ${esHighSwept ? 'text-white/40 line-through' : 'text-bearish'}`}>
                {esSessionHigh.toFixed(2)}{esHighSwept ? ' swept' : ''}
              </span>
            </div>
            <div className="flex justify-between text-sm font-bold font-mono">
              <span className="text-white/70">ES SSL</span>
              <span className={`tabular-nums ${esLowSwept ? 'text-white/40 line-through' : 'text-bullish'}`}>
                {esSessionLow?.toFixed(2)}{esLowSwept ? ' swept' : ''}
              </span>
            </div>
          </>
        ) : (
          <span className="text-sm font-bold font-mono text-white/50 tracking-wider">No session data</span>
        )}
        {nqSessionHigh !== null && (
          <>
            <div className="flex justify-between text-sm font-bold font-mono">
              <span className="text-white/70">NQ BSL</span>
              <span className={`tabular-nums ${nqHighSwept ? 'text-white/40 line-through' : 'text-bearish'}`}>
                {nqSessionHigh.toFixed(2)}{nqHighSwept ? ' swept' : ''}
              </span>
            </div>
            <div className="flex justify-between text-sm font-bold font-mono">
              <span className="text-white/70">NQ SSL</span>
              <span className={`tabular-nums ${nqLowSwept ? 'text-white/40 line-through' : 'text-bullish'}`}>
                {nqSessionLow?.toFixed(2)}{nqLowSwept ? ' swept' : ''}
              </span>
            </div>
          </>
        )}
      </div>

    </aside>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function JournalView() {
  const {
    esDailyBias, nqDailyBias,
    esBiasFactors, nqBiasFactors,
    smt, confluence,
    currentPrice, nqCurrentPrice,
  } = useMarketStream();

  const [trades, setTrades]   = useState<TradeEntry[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft]     = useState<Partial<TradeEntry>>({
    symbol: 'ES', direction: 'LONG', result: 'OPEN',
  });

  useEffect(() => {
    const saved = localStorage.getItem('fractal_engine_journal');
    if (saved) {
      try { setTrades(JSON.parse(saved)); } catch { /* malformed data */ }
    }
  }, []);

  const session     = getCurrentSession();
  const sessionLabel = session ? SESSION_LABELS[session] : 'Between Sessions';
  const dateStr     = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const nowStr = new Date().toTimeString().slice(0, 5);

  const esLiq = session ? esBiasFactors.sessionLiq.find(s => s.session === session) : null;
  const nqLiq = session ? nqBiasFactors.sessionLiq.find(s => s.session === session) : null;

  function setField(key: string, val: string) {
    setDraft(d => ({ ...d, [key]: val }));
  }

  function submitTrade() {
    const e = Number(draft.entry), s = Number(draft.stop), t = Number(draft.target);
    if (!e || !s || !t) return;
    const newTrade: TradeEntry = {
      id: Date.now(), time: nowStr,
      symbol: draft.symbol ?? 'ES',
      direction: draft.direction ?? 'LONG',
      entry: e, stop: s, target: t,
      session: session ?? 'NONE',
      bias: esDailyBias.bias,
      result: draft.result ?? 'OPEN',
      notes: draft.notes ?? '',
    };
    setTrades(prev => {
      const updated = [newTrade, ...prev];
      localStorage.setItem('fractal_engine_journal', JSON.stringify(updated));
      return updated;
    });
    setAddOpen(false);
    setDraft({ symbol: 'ES', direction: 'LONG', result: 'OPEN' });
  }

  return (
    <div className="flex flex-col h-full bg-[#000000] text-foreground overflow-hidden">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#1c1c1e] bg-surface shrink-0">
        <div>
          <span className="font-serif text-xl font-bold tracking-[0.1em] text-white uppercase block">
            Trading Journal
          </span>
          <span className="text-sm font-bold font-mono text-white/60 tracking-wider mt-1 block">{dateStr}</span>
        </div>
        <div className="flex items-center gap-2.5">
          {session && <span className="h-2.5 w-2.5 rounded-full bg-[#d4af37] shrink-0" />}
          {!session && <span className="h-2.5 w-2.5 rounded-full bg-white/40 shrink-0" />}
          <span className={`text-base font-bold font-mono uppercase tracking-[0.18em] ${session ? 'text-[#d4af37]' : 'text-white/55'}`}>
            {sessionLabel}
          </span>
        </div>
      </header>

      {/* Performance stats */}
      <StatsBar trades={trades} />

      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Signal sidebar */}
        <SignalSidebar
          smt={smt}
          confluence={confluence}
          esPrice={currentPrice}
          nqPrice={nqCurrentPrice}
          esBias={esDailyBias.bias}
          nqBias={nqDailyBias.bias}
          esSessionHigh={esLiq?.high ?? null}
          esSessionLow={esLiq?.low ?? null}
          nqSessionHigh={nqLiq?.high ?? null}
          nqSessionLow={nqLiq?.low ?? null}
          esHighSwept={esLiq?.highSwept ?? false}
          esLowSwept={esLiq?.lowSwept ?? false}
          nqHighSwept={nqLiq?.highSwept ?? false}
          nqLowSwept={nqLiq?.lowSwept ?? false}
          sessionLabel={sessionLabel}
        />

        {/* Trade log */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Log header + add button */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#1c1c1e] bg-surface shrink-0">
            <span className="text-base font-bold font-mono uppercase tracking-[0.14em] text-white">Trade Log</span>
            <button
              onClick={() => setAddOpen(o => !o)}
              className="px-3 py-1.5 text-sm font-bold font-mono uppercase tracking-[0.18em] bg-[#d4af37]/10 text-[#d4af37] border border-[#d4af37]/30 rounded hover:bg-[#d4af37]/20 hover:border-[#d4af37]/50 transition-all duration-700 ease-in-out"
            >
              + Add Entry
            </button>
          </div>

          {/* Add entry form */}
          {addOpen && (
            <div className="px-5 py-4 border-b border-[#1c1c1e] bg-surface flex flex-wrap gap-4 items-end shrink-0">
              {([
                { key: 'symbol',    label: 'Symbol',    type: 'select', opts: ['ES','NQ'] },
                { key: 'direction', label: 'Dir',       type: 'select', opts: ['LONG','SHORT'] },
                { key: 'entry',     label: 'Entry',     type: 'number' },
                { key: 'stop',      label: 'Stop',      type: 'number' },
                { key: 'target',    label: 'Target',    type: 'number' },
                { key: 'result',    label: 'Result',    type: 'select', opts: ['OPEN','WIN','LOSS','BE'] },
                { key: 'notes',     label: 'Notes',     type: 'text' },
              ] as { key: string; label: string; type: string; opts?: string[] }[]).map(f => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold font-mono uppercase tracking-[0.18em] text-white/70">{f.label}</label>
                  {f.type === 'select' ? (
                    <select
                      className="bg-[#1c1c1e] border border-[#2a2a2d] rounded px-2.5 py-1.5 text-base font-bold font-mono text-white focus:outline-none focus:border-[#d4af37]/50 transition-all duration-700 ease-in-out"
                      value={(draft as Record<string, unknown>)[f.key] as string ?? ''}
                      onChange={e => setField(f.key, e.target.value)}
                    >
                      {f.opts?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type={f.type === 'number' ? 'number' : 'text'}
                      className="bg-[#1c1c1e] border border-[#2a2a2d] rounded px-2.5 py-1.5 text-base font-bold font-mono text-white w-28 focus:outline-none focus:border-[#d4af37]/50 transition-all duration-700 ease-in-out"
                      value={(draft as Record<string, unknown>)[f.key] as string ?? ''}
                      onChange={e => setField(f.key, e.target.value)}
                    />
                  )}
                </div>
              ))}
              <button
                onClick={submitTrade}
                className="px-3 py-1.5 text-sm font-bold font-mono uppercase tracking-[0.18em] bg-bullish/12 text-bullish border border-bullish/30 rounded hover:bg-bullish/20 transition-all duration-700 ease-in-out"
              >
                Record
              </button>
              <button
                onClick={() => setAddOpen(false)}
                className="px-3 py-1.5 text-sm font-bold font-mono uppercase tracking-[0.18em] bg-[#000000] text-white/60 border border-[#2a2a2d] rounded hover:text-white transition-all duration-700 ease-in-out"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Table */}
          <div className="flex-1 overflow-auto">
            {trades.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
                <span className="font-serif text-xl font-bold text-white/50 tracking-[0.12em] uppercase">No Trades Recorded</span>
                <span className="text-base font-bold font-mono text-white/50 leading-relaxed tracking-wider max-w-md">
                  Use + Add Entry to log a setup. Bias and session context are auto-stamped from live data.
                </span>
              </div>
            ) : (
              <table className="w-full text-sm font-mono">
                <thead className="sticky top-0 bg-surface border-b border-[#1c1c1e] z-10">
                  <tr>
                    {['Time','Sym','Dir','Entry','Stop','Target','Session','Bias','R:R','Result','Notes'].map(h => (
                      <th key={h} className="px-3 py-3 text-left text-sm font-bold uppercase tracking-[0.16em] text-white whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map(t => {
                    const rrRaw = (t.target - t.entry) / Math.abs(t.entry - t.stop);
                    const rr = isNaN(rrRaw) ? '—' : rrRaw.toFixed(2);
                    return (
                      <tr key={t.id} className="border-b border-[#1c1c1e] hover:bg-surface transition-all duration-700 ease-in-out">
                        <td className="px-3 py-3 text-[#c0c0c0] font-bold tabular-nums whitespace-nowrap">{t.time}</td>
                        <td className="px-3 py-3 text-white font-bold">{t.symbol}</td>
                        <td className={`px-3 py-3 font-bold ${t.direction === 'LONG' ? 'text-bullish' : 'text-bearish'}`}>
                          {t.direction}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-white font-bold">{t.entry.toFixed(2)}</td>
                        <td className="px-3 py-3 tabular-nums text-bearish font-bold">{t.stop.toFixed(2)}</td>
                        <td className="px-3 py-3 tabular-nums text-bullish font-bold">{t.target.toFixed(2)}</td>
                        <td className="px-3 py-3 text-[#c0c0c0] font-bold whitespace-nowrap">{t.session}</td>
                        <td className={`px-3 py-3 font-bold ${biasCls(t.bias)}`}>{t.bias}</td>
                        <td className="px-3 py-3 tabular-nums text-[#d4af37] font-bold">{rr}</td>
                        <td className={`px-3 py-3 font-bold ${resultCls(t.result)}`}>{t.result}</td>
                        <td className="px-3 py-3 text-white/70 font-medium max-w-[160px] truncate">{t.notes || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
