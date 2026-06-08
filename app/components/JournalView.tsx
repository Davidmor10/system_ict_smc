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

function resultCls(r: TradeResult): string {
  if (r === 'WIN')  return 'text-bullish';
  if (r === 'LOSS') return 'text-bearish';
  if (r === 'BE')   return 'text-gold';
  return 'text-muted/50';
}

function biasCls(b: Bias): string {
  return b === 'BULLISH' ? 'text-bullish' : b === 'BEARISH' ? 'text-bearish' : 'text-muted/60';
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
    <aside className="w-72 shrink-0 border-r border-[#1c1c1e] flex flex-col gap-5 px-5 py-5 overflow-y-auto">

      {/* Bias snapshot */}
      <div className="flex flex-col gap-2">
        <span className="text-[8px] font-mono uppercase tracking-[0.28em] text-muted/50 border-b border-[#1c1c1e] pb-1.5">
          Live Bias
        </span>
        {([['ES', esBias, esPrice], ['NQ', nqBias, nqPrice]] as [string, Bias, number][]).map(([sym, b, p]) => (
          <div key={sym} className="flex items-center justify-between py-1.5 border-b border-[#1c1c1e] last:border-0">
            <span className="text-[9px] font-mono text-muted/60 uppercase tracking-wider w-6 shrink-0">{sym}</span>
            <span className={`text-[10px] font-mono font-semibold ${biasCls(b as Bias)}`}>
              {b === 'BULLISH' ? '▲' : b === 'BEARISH' ? '▼' : '◈'} {b}
            </span>
            <span className="text-[10px] font-mono text-foreground tabular-nums">{(p as number).toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Confluence checklist */}
      <div className={`flex flex-col gap-2 rounded border p-4 transition-all duration-700 ease-in-out ${confluence.active ? 'border-gold/30 bg-gold/5' : 'border-[#1c1c1e]'}`}>
        <div className="flex items-center justify-between">
          <span className="text-[8px] font-mono uppercase tracking-[0.28em] text-muted/50">Confluence</span>
          <span className={`text-[9px] font-mono ${confluence.score === 3 ? 'text-gold' : confluence.score === 2 ? 'text-gold/60' : 'text-muted/50'}`}>
            {confluence.score}/3
          </span>
        </div>
        {confluence.active && (
          <span className="text-[9px] font-mono text-gold tracking-[0.15em]">◈ ENTRY SIGNAL</span>
        )}
        {[
          { label: 'HTF Zone Aligned', on: confluence.htfZoneAligned },
          { label: 'Liquidity Sweep',  on: confluence.liquiditySweep },
          { label: 'SMT Divergence',   on: confluence.smtDivergence  },
        ].map(r => (
          <div key={r.label} className="flex items-center gap-2">
            <span className={`text-[9px] transition-all duration-700 ease-in-out ${r.on ? 'text-gold' : 'text-[#1c1c1e]'}`}>{r.on ? '✓' : '○'}</span>
            <span className={`text-[9px] font-mono tracking-wider transition-all duration-700 ease-in-out ${r.on ? 'text-foreground' : 'text-muted/50'}`}>{r.label}</span>
          </div>
        ))}
      </div>

      {/* SMT alert */}
      {smt.active && smt.type && (
        <div className="rounded border border-gold/20 bg-gold/5 p-4 flex flex-col gap-2">
          <span className="text-[8px] font-mono uppercase tracking-[0.28em] text-muted/50">SMT Divergence</span>
          <span className={`text-[11px] font-mono ${smt.type === 'BULLISH_SMT' ? 'text-bullish' : 'text-bearish'}`}>
            {smt.type.replace('_', ' ')}
          </span>
          <p className="text-[9px] font-mono text-muted/60 leading-relaxed tracking-wide">
            {smt.type === 'BULLISH_SMT'
              ? 'ES swept SSL; NQ held. Watch for bullish reversal.'
              : 'ES swept BSL; NQ failed to confirm. Bearish div.'}
          </p>
        </div>
      )}

      {/* Active session liq */}
      <div className="flex flex-col gap-2">
        <span className="text-[8px] font-mono uppercase tracking-[0.28em] text-muted/50 border-b border-[#1c1c1e] pb-1.5">
          {sessionLabel}
        </span>
        {esSessionHigh !== null ? (
          <>
            <div className="flex justify-between text-[9px] font-mono">
              <span className="text-muted/60">ES BSL</span>
              <span className={`tabular-nums ${esHighSwept ? 'text-muted/40 line-through' : 'text-bearish'}`}>
                {esSessionHigh.toFixed(2)}{esHighSwept ? ' swept' : ''}
              </span>
            </div>
            <div className="flex justify-between text-[9px] font-mono">
              <span className="text-muted/60">ES SSL</span>
              <span className={`tabular-nums ${esLowSwept ? 'text-muted/40 line-through' : 'text-bullish'}`}>
                {esSessionLow?.toFixed(2)}{esLowSwept ? ' swept' : ''}
              </span>
            </div>
          </>
        ) : (
          <span className="text-[9px] font-mono text-muted/40 italic tracking-wider">No session data</span>
        )}
        {nqSessionHigh !== null && (
          <>
            <div className="flex justify-between text-[9px] font-mono">
              <span className="text-muted/60">NQ BSL</span>
              <span className={`tabular-nums ${nqHighSwept ? 'text-muted/40 line-through' : 'text-bearish'}`}>
                {nqSessionHigh.toFixed(2)}{nqHighSwept ? ' swept' : ''}
              </span>
            </div>
            <div className="flex justify-between text-[9px] font-mono">
              <span className="text-muted/60">NQ SSL</span>
              <span className={`tabular-nums ${nqLowSwept ? 'text-muted/40 line-through' : 'text-bullish'}`}>
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
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#1c1c1e] bg-surface shrink-0">
        <div>
          <span className="font-serif text-[13px] tracking-[0.12em] text-foreground uppercase block">
            Trading Journal
          </span>
          <span className="text-[9px] font-mono text-muted/50 tracking-wider mt-0.5 block">{dateStr}</span>
        </div>
        <div className="flex items-center gap-2">
          {session && <span className="h-1.5 w-1.5 rounded-full bg-gold shrink-0" />}
          <span className={`text-[9px] font-mono uppercase tracking-[0.22em] ${session ? 'text-gold' : 'text-muted/50'}`}>
            {session ? sessionLabel : sessionLabel}
          </span>
        </div>
      </header>

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
          <div className="flex items-center justify-between px-5 py-2.5 border-b border-[#1c1c1e] bg-surface shrink-0">
            <span className="text-[8px] font-mono uppercase tracking-[0.28em] text-muted/50">Trade Log</span>
            <button
              onClick={() => setAddOpen(o => !o)}
              className="px-3 py-1 text-[9px] font-mono uppercase tracking-[0.18em] bg-gold/8 text-gold border border-gold/20 rounded hover:bg-gold/15 hover:border-gold/35 transition-all duration-700 ease-in-out"
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
                <div key={f.key} className="flex flex-col gap-1">
                  <label className="text-[8px] font-mono uppercase tracking-[0.25em] text-muted/50">{f.label}</label>
                  {f.type === 'select' ? (
                    <select
                      className="bg-background border border-[#1c1c1e] rounded px-2 py-1 text-[9px] font-mono text-foreground focus:outline-none focus:border-gold/30 transition-all duration-700 ease-in-out"
                      value={(draft as Record<string, unknown>)[f.key] as string ?? ''}
                      onChange={e => setField(f.key, e.target.value)}
                    >
                      {f.opts?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type={f.type === 'number' ? 'number' : 'text'}
                      className="bg-background border border-[#1c1c1e] rounded px-2 py-1 text-[9px] font-mono text-foreground w-24 focus:outline-none focus:border-gold/30 transition-all duration-700 ease-in-out"
                      value={(draft as Record<string, unknown>)[f.key] as string ?? ''}
                      onChange={e => setField(f.key, e.target.value)}
                    />
                  )}
                </div>
              ))}
              <button
                onClick={submitTrade}
                className="px-3 py-1 text-[9px] font-mono uppercase tracking-[0.18em] bg-bullish/10 text-bullish border border-bullish/25 rounded hover:bg-bullish/20 transition-all duration-700 ease-in-out"
              >
                Record
              </button>
              <button
                onClick={() => setAddOpen(false)}
                className="px-3 py-1 text-[9px] font-mono uppercase tracking-[0.18em] bg-background text-muted/60 border border-[#1c1c1e] rounded hover:text-foreground transition-all duration-700 ease-in-out"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            {trades.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
                <span className="font-serif text-[15px] text-foreground/40 tracking-[0.12em] uppercase">No Trades Recorded</span>
                <span className="text-[9px] font-mono text-muted/40 leading-relaxed tracking-wider max-w-xs">
                  Use + Add Entry to log a setup. Bias and session context are auto-stamped from live data.
                </span>
              </div>
            ) : (
              <table className="w-full text-[9px] font-mono">
                <thead className="sticky top-0 bg-surface border-b border-[#1c1c1e] z-10">
                  <tr>
                    {['Time','Sym','Dir','Entry','Stop','Target','Session','Bias','R:R','Result','Notes'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-[8px] uppercase tracking-[0.2em] text-muted/50 font-normal whitespace-nowrap">
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
                        <td className="px-3 py-2.5 text-muted/50 tabular-nums">{t.time}</td>
                        <td className="px-3 py-2.5 text-foreground">{t.symbol}</td>
                        <td className={`px-3 py-2.5 font-semibold ${t.direction === 'LONG' ? 'text-bullish' : 'text-bearish'}`}>
                          {t.direction}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-foreground">{t.entry.toFixed(2)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-bearish">{t.stop.toFixed(2)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-bullish">{t.target.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-muted/60">{t.session}</td>
                        <td className={`px-3 py-2.5 ${biasCls(t.bias)}`}>{t.bias}</td>
                        <td className="px-3 py-2.5 tabular-nums text-gold">{rr}</td>
                        <td className={`px-3 py-2.5 font-semibold ${resultCls(t.result)}`}>{t.result}</td>
                        <td className="px-3 py-2.5 text-muted/50 max-w-[140px] truncate">{t.notes || '—'}</td>
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
