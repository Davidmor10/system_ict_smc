'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useCountUp } from '../hooks/useCountUp';
import { useMarketStream } from '../hooks/useMarketStream';
import type { Bias, SessionName } from '../hooks/useMarketStream';

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

// Aggregate realized performance across all closed trades — shared by the top
// stats bar and the sidebar summary so the two can never disagree.
function computeStats(trades: TradeEntry[]) {
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

  return { wins, losses, winRate, profitFactor, totalPnL };
}

const fmtWinRate      = (n: number) => `${n.toFixed(1)}%`;
const fmtProfitFactor = (n: number) => (n === Infinity ? '∞' : n.toFixed(2));

// ─── Mobile performance bar (inline, shown only on small screens) ────────────

function MobilePerformanceBar({ trades }: { trades: TradeEntry[] }) {
  const { winRate, profitFactor, totalPnL } = computeStats(trades);
  const animWinRate = useCountUp(winRate, 500);
  const animPnL     = useCountUp(totalPnL, 600);

  return (
    <div className="md:hidden flex items-center gap-px bg-[#1c1c1e] border-b border-[#1c1c1e] shrink-0">
      {[
        { label: 'Win Rate', val: fmtWinRate(animWinRate) },
        { label: 'PF',       val: fmtProfitFactor(profitFactor) },
        { label: 'PnL',      val: usd(animPnL) },
      ].map(m => (
        <div key={m.label} className="flex-1 bg-[#000000] px-3 py-2 flex flex-col gap-0.5">
          <span className="text-[10px] font-bold font-mono text-white/50 uppercase tracking-[0.14em]">{m.label}</span>
          <span className={`text-base font-black font-mono tabular-nums ${GOLD_GLOW}`}>{m.val}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Top bar — trade volume only (performance lives in the sidebar) ─────────────

function StatsBar({ trades }: { trades: TradeEntry[] }) {
  const { wins, losses } = computeStats(trades);

  return (
    <div className="flex items-center gap-px bg-[#1c1c1e] border-b border-[#1c1c1e] shrink-0">
      <div className="bg-[#000000] px-6 py-4 flex flex-col gap-1.5">
        <span className="text-sm font-bold font-mono text-white/60 uppercase tracking-[0.18em]">Trades</span>
        <span className="text-3xl font-black font-mono tabular-nums text-white">
          {trades.length}
          <span className="text-base font-bold text-white/50 ml-2">{wins}W · {losses}L</span>
        </span>
      </div>
    </div>
  );
}

// ─── Performance summary sidebar ───────────────────────────────────────────────

function PerformanceSidebar({ trades }: { trades: TradeEntry[] }) {
  const { winRate, profitFactor, totalPnL } = computeStats(trades);

  const animWinRate      = useCountUp(winRate,      500);
  const animProfitFactor = useCountUp(profitFactor === Infinity ? 0 : profitFactor, 500);
  const animPnL          = useCountUp(totalPnL,     600);

  const metrics = [
    { label: 'Win Rate',      val: fmtWinRate(animWinRate),
      accent: GOLD_GLOW },
    { label: 'Profit Factor', val: profitFactor === Infinity ? '∞' : animProfitFactor.toFixed(2),
      accent: GOLD_GLOW },
    { label: 'Total PnL',     val: usd(animPnL),
      accent: animPnL < 0 ? 'text-bearish' : GOLD_GLOW },
  ];

  return (
    <aside className="w-72 shrink-0 border-r border-[#1c1c1e] flex flex-col gap-6 px-6 py-8 overflow-y-auto bg-[#000000]">
      <span className="text-sm font-bold font-mono uppercase tracking-[0.22em] text-white border-b border-[#1c1c1e] pb-3">
        Performance Summary
      </span>
      <div className="flex flex-col gap-3">
        {metrics.map((m, i) => (
          <div
            key={m.label}
            className="lift flex flex-col gap-1.5 rounded-lg border border-[#1c1c1e] bg-[#0d0d0f] px-4 py-3.5"
            style={{ transitionDelay: `${i * 40}ms` }}
          >
            <span className="text-xs font-bold font-mono text-white/55 uppercase tracking-[0.18em]">{m.label}</span>
            <span className={`text-2xl font-black font-mono tabular-nums ${m.accent}`}>{m.val}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ─── Trade snapshot — drag-and-drop chart attachment (local preview only) ───────
// UI placeholder: no server upload yet. Holds an in-memory object URL so the
// user can attach/preview a chart screenshot per entry.

function ChartUpload() {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke the object URL when it changes or the component unmounts (no leaks).
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview.url); };
  }, [preview]);

  const handleFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    setPreview({ url: URL.createObjectURL(file), name: file.name });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-bold font-mono uppercase tracking-[0.18em] text-white/70">Chart</label>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
        className={`flex items-center gap-2 h-[38px] px-3 rounded border border-dashed cursor-pointer transition-all duration-300 ${
          dragOver ? 'border-[#d4af37] bg-[#d4af37]/10' : 'border-[#2a2a2d] bg-[#1c1c1e] hover:border-[#d4af37]/50'
        }`}
        title="Drag & drop an image, or click to browse"
      >
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt="chart preview" className="h-6 w-6 rounded-sm object-cover border border-[#d4af37]/30" />
            <span className="text-sm font-bold font-mono text-white/80 max-w-[110px] truncate">{preview.name}</span>
            <button
              onClick={e => { e.stopPropagation(); setPreview(null); }}
              className="ml-1 text-sm font-bold text-white/40 hover:text-bearish transition-colors"
              aria-label="Remove chart"
            >
              ✕
            </button>
          </>
        ) : (
          <span className="text-sm font-bold font-mono text-[#d4af37]/70 tracking-wide whitespace-nowrap">⬆ Upload Chart</span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => handleFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function JournalView() {
  const { esDailyBias } = useMarketStream();

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
    <div className="flex flex-col flex-1 min-h-0 bg-[#000000] text-foreground">

      {/* Header */}
      <header className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-[#1c1c1e] bg-surface shrink-0">
        <div>
          <span className="font-serif text-lg md:text-xl font-bold tracking-[0.1em] text-white uppercase block">
            Trading Journal
          </span>
          <span className="hidden md:block text-sm font-bold font-mono text-white/60 tracking-wider mt-1">{dateStr}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full shrink-0 ${session ? 'bg-[#d4af37]' : 'bg-white/40'}`} />
          <span className={`text-xs md:text-base font-bold font-mono uppercase tracking-[0.14em] md:tracking-[0.18em] ${session ? 'text-[#d4af37]' : 'text-white/55'}`}>
            {session ?? 'No Session'}
          </span>
        </div>
      </header>

      {/* Performance stats */}
      <StatsBar trades={trades} />

      {/* Mobile performance metrics (inline, hidden on desktop) */}
      <MobilePerformanceBar trades={trades} />

      <div className="flex flex-1 min-h-0">

        {/* Performance summary sidebar — desktop only */}
        <div className="hidden md:block"><PerformanceSidebar trades={trades} /></div>

        {/* Trade log */}
        <div className="flex flex-col flex-1 min-w-0">

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
            <div className="px-4 md:px-5 py-4 border-b border-[#1c1c1e] bg-surface grid grid-cols-2 md:flex md:flex-wrap gap-3 items-end shrink-0">
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

              {/* Trade snapshot attachment (UI only — no upload yet) */}
              <ChartUpload />

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
              <table className="w-full text-xs md:text-sm font-mono">
                <thead className="sticky top-0 bg-surface border-b border-[#1c1c1e] z-10">
                  <tr>
                    {['Time','Sym','Dir','Entry','Stop','Tgt','R:R','Result'].map(h => (
                      <th key={h} className="px-2 md:px-3 py-2.5 text-left text-xs font-bold uppercase tracking-[0.14em] text-white whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                    <th className="hidden md:table-cell px-3 py-2.5 text-left text-xs font-bold uppercase tracking-[0.14em] text-white whitespace-nowrap">Session</th>
                    <th className="hidden md:table-cell px-3 py-2.5 text-left text-xs font-bold uppercase tracking-[0.14em] text-white whitespace-nowrap">Bias</th>
                    <th className="hidden md:table-cell px-3 py-2.5 text-left text-xs font-bold uppercase tracking-[0.14em] text-white whitespace-nowrap">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map(t => {
                    const rrRaw = (t.target - t.entry) / Math.abs(t.entry - t.stop);
                    const rr = isNaN(rrRaw) ? '—' : rrRaw.toFixed(2);
                    return (
                      <tr key={t.id} className="border-b border-[#1c1c1e] hover:bg-surface transition-colors duration-300">
                        <td className="px-2 md:px-3 py-2.5 text-[#c0c0c0] font-bold tabular-nums whitespace-nowrap">{t.time}</td>
                        <td className="px-2 md:px-3 py-2.5 text-white font-bold">{t.symbol}</td>
                        <td className={`px-2 md:px-3 py-2.5 font-bold ${t.direction === 'LONG' ? 'text-bullish' : 'text-bearish'}`}>
                          {t.direction === 'LONG' ? 'L' : 'S'}<span className="hidden md:inline">{t.direction === 'LONG' ? 'ONG' : 'HORT'}</span>
                        </td>
                        <td className="px-2 md:px-3 py-2.5 tabular-nums text-white font-bold">{t.entry.toFixed(2)}</td>
                        <td className="px-2 md:px-3 py-2.5 tabular-nums text-bearish font-bold">{t.stop.toFixed(2)}</td>
                        <td className="px-2 md:px-3 py-2.5 tabular-nums text-bullish font-bold">{t.target.toFixed(2)}</td>
                        <td className="px-2 md:px-3 py-2.5 tabular-nums text-[#d4af37] font-bold">{rr}</td>
                        <td className={`px-2 md:px-3 py-2.5 font-bold ${resultCls(t.result)}`}>{t.result}</td>
                        <td className="hidden md:table-cell px-3 py-2.5 text-[#c0c0c0] font-bold whitespace-nowrap">{t.session}</td>
                        <td className={`hidden md:table-cell px-3 py-2.5 font-bold ${biasCls(t.bias)}`}>{t.bias}</td>
                        <td className="hidden md:table-cell px-3 py-2.5 text-white/70 font-medium max-w-[160px] truncate">{t.notes || '—'}</td>
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
