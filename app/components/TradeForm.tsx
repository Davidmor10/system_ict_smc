'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { TradeEntry, Direction, TradeResult } from '../lib/journal';
import { todayISO, computeStats } from '../lib/journal';
import { calcRR, calcPnL, calcRealizedR, calcPoints, calcTicks } from '../lib/calc/trade';
import { INSTRUMENT_KEYS, INSTRUMENTS, type InstrumentKey } from '../lib/instruments';
import { SESS, getActiveSessionKey, type SessionKey } from '../lib/sessions';
import { analyzeInstruments, isoWeekKey, normSession } from '../lib/analytics';
import { getTodaysDeclaredBias, computeBiasAlignment } from '../lib/dailyBias';
import ScreenshotUpload from './ScreenshotUpload';
import TypingDots from './TypingDots';

const PLAYBOOK_STORAGE_KEY = 'onyx_playbook';
/** IFVG confirmation timeframe is no longer surfaced to the trader — kept as a fixed default so
    older analytics/exports that read TradeEntry.confirmation keep working. */
const DEFAULT_CONFIRMATION = 'IFVG_2M' as const;

interface PlaybookSetup { id: string; name: string; }

function loadPlaybookSetups(): PlaybookSetup[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PLAYBOOK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is PlaybookSetup => !!s?.name) : [];
  } catch {
    return [];
  }
}

/* ── Every field maps to a specific future insight:
   instrument/contracts/direction/result → win-rate + gross-PnL breakdowns, instrument-aware
   entry/stop/target                    → RR distribution, planned-vs-realized edge, points/ticks
   session                              → win-rate-by-session (drives the AI coach)
   bias alignment (auto)                → the Discipline Score on the dashboard hero
   model                                → picked from the Playbook; drives per-model performance analytics
   screenshots/notes                    → fed into the AI's pattern + psychology analysis
   Setup checklist lives in the Playbook now, not on every trade — keeping the journal fast.
   PnL is never typed in by hand — it's always derived from instrument spec × contracts. ── */

interface FormState {
  symbol: InstrumentKey;
  contracts: string;
  direction: Direction;
  date: string;
  time: string;
  entry: string;
  stop: string;
  target: string;
  result: TradeResult;
  model: string;
  session: SessionKey | '';
  notes: string;
  screenshots: string[];
}

function empty(): FormState {
  const now = new Date();
  return {
    symbol: 'ES',
    contracts: '1',
    direction: 'LONG',
    date: todayISO(),
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    entry: '',
    stop: '',
    target: '',
    result: 'OPEN',
    model: '',
    session: getActiveSessionKey() ?? '',
    notes: '',
    screenshots: [],
  };
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** One line straight from the analytics engine — no network call, so it's on screen
    instantly. Only fires once the trader has 3+ trades logged (any dates), matching
    the same threshold every AI surface in the app uses. */
function buildInstantInsight(trade: TradeEntry, allTrades: TradeEntry[]): string | null {
  if (allTrades.length < 3) return null;

  if (trade.session && trade.session !== 'NONE') {
    const week = isoWeekKey(trade.dateISO);
    const sessionThisWeek = allTrades.filter(t => normSession(t.session) === normSession(trade.session) && isoWeekKey(t.dateISO) === week);
    const decided = sessionThisWeek.filter(t => t.result === 'WIN' || t.result === 'LOSS');
    if (decided.length > 0) {
      const wins = sessionThisWeek.filter(t => t.result === 'WIN').length;
      const winRate = Math.round((wins / decided.length) * 100);
      const label = SESS.find(s => s.key === trade.session)?.en ?? trade.session;
      return `This was your ${ordinal(sessionThisWeek.length)} ${label} trade this week. Current ${label} win rate: ${winRate}%.`;
    }
  }

  const strongInstruments = analyzeInstruments(allTrades).filter(g => g.confidence.level !== 'low');
  if (strongInstruments.length > 0) {
    const best = strongInstruments.reduce((a, b) => (b.winRate > a.winRate ? b : a));
    return `${best.key} remains your strongest instrument by win rate (${best.winRate.toFixed(0)}%).`;
  }

  return null;
}

/** Short, immediate feedback lines shown right after a trade is logged — not a deep
    review, just proof the system did something with the entry. */
function buildFacts(trade: TradeEntry, priorTrades: TradeEntry[]): string[] {
  const facts: string[] = [];
  const allTrades = [trade, ...priorTrades];

  if (trade.session && trade.session !== 'NONE') {
    const label = SESS.find(s => s.key === trade.session)?.en ?? trade.session;
    facts.push(`Added to ${label} session stats.`);
  }

  const rr = calcRR(trade.entry, trade.stop, trade.target);
  if (rr !== null) facts.push(`Planned RR calculated automatically: ${rr.toFixed(2)}R.`);

  if (trade.result === 'OPEN') {
    facts.push('Marked Open — update the result once it closes.');
  } else {
    const after = computeStats(allTrades);
    facts.push(`Win rate updated to ${after.winRate.toFixed(0)}%.`);
  }

  facts.push(trade.biasAlignment === 'ALIGNED' ? 'Aligned with today’s bias.' : 'Logged as counter-trend for awareness.');

  const instant = buildInstantInsight(trade, allTrades);
  if (instant) facts.push(instant);

  return facts.slice(0, 5);
}

function Group({ label, tone = 'primary', children }: { label: string; tone?: 'primary' | 'muted'; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <span className={`block font-mono text-[10px] font-bold uppercase tracking-[0.22em] ${tone === 'primary' ? 'text-[#d4af37]/55' : 'text-white/25'}`}>
        {label}
      </span>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-white/35 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full bg-[#111] border border-[#222] rounded-xl px-3 py-2.5 font-mono text-sm text-white placeholder-white/20 outline-none ' +
  'transition-all duration-150 tabular-nums focus:border-[#d4af37]/60 focus:ring-2 focus:ring-[#d4af37]/10';
const toggleBtn = (active: boolean, activeCls: string) =>
  `flex-1 py-2.5 rounded-xl border font-mono text-sm font-bold transition-all duration-150 ${active ? activeCls : 'border-[#222] text-white/40 hover:text-white/70 hover:border-[#2a2a2d]'}`;

type SaveStage = 'idle' | 'saving' | 'analyzing' | 'summary';

export default function TradeForm({
  onSave,
  onCancel,
  onDone,
  trades = [],
}: {
  onSave: (trade: TradeEntry) => void;
  onCancel?: () => void;
  /** Called when the trader is done with the post-save summary and wants to leave the form. Falls back to onCancel. */
  onDone?: () => void;
  /** Existing trades, used only to compute immediate before/after feedback (e.g. win rate) after saving. */
  trades?: TradeEntry[];
}) {
  const [form, setForm] = useState<FormState>(empty());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [playbookSetups, setPlaybookSetups] = useState<PlaybookSetup[]>([]);
  const [stage, setStage] = useState<SaveStage>('idle');
  const [summaryFacts, setSummaryFacts] = useState<string[]>([]);

  useEffect(() => {
    setPlaybookSetups(loadPlaybookSetups());
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const entry     = parseFloat(form.entry);
  const stop      = parseFloat(form.stop);
  const target    = parseFloat(form.target);
  const contracts = Math.max(1, parseInt(form.contracts, 10) || 1);

  const rr = (isFinite(entry) && isFinite(stop) && isFinite(target))
    ? calcRR(entry, stop, target)
    : null;

  const exitPrice = form.result === 'WIN' ? target : form.result === 'LOSS' ? stop : null;
  const hasExit = exitPrice !== null && isFinite(entry) && isFinite(exitPrice);

  const points = (form.result !== 'OPEN' && hasExit) ? calcPoints(entry, exitPrice!, form.direction) : form.result === 'BE' ? 0 : null;
  const ticks  = (form.result !== 'OPEN' && hasExit) ? calcTicks(entry, exitPrice!, form.direction, form.symbol) : form.result === 'BE' ? 0 : null;

  const pnl = (form.result !== 'OPEN' && form.result !== 'BE' && hasExit)
    ? calcPnL(entry, exitPrice!, form.direction, form.symbol, contracts)
    : form.result === 'BE' ? 0 : null;

  const realizedR = (form.result !== 'OPEN' && isFinite(entry) && isFinite(stop))
    ? (form.result === 'WIN' && isFinite(target) ? calcRealizedR(entry, target, stop, form.direction)
      : form.result === 'LOSS' ? calcRealizedR(entry, stop, stop, form.direction)
      : 0)
    : null;

  // Auto-derived — no extra click, just shown as context next to the manual session choice.
  const declaredBias = getTodaysDeclaredBias();
  const alignment = computeBiasAlignment(declaredBias, form.direction);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.entry || !form.stop || !form.target || stage !== 'idle') return;

    const trade: TradeEntry = {
      id: Date.now(),
      dateISO: form.date,
      time: form.time,
      symbol: form.symbol,
      contracts,
      direction: form.direction,
      entry,
      stop,
      target,
      result: form.result,
      session: form.session || 'NONE',
      bias: declaredBias ?? 'INDECISIVE',
      model: form.model || 'Unspecified',
      confirmation: DEFAULT_CONFIRMATION,
      notes: form.notes,
      screenshots: form.screenshots.length ? form.screenshots : undefined,
      tradeR: realizedR ?? undefined,
      pnlUsd: pnl ?? undefined,
      biasAlignment: alignment,
    };

    const priorTrades = trades;

    // A short, active sequence — saving, then a quick read, then proof the system used it —
    // so logging a trade feels like the system did work, not like a form reset.
    setStage('saving');
    setTimeout(() => {
      onSave(trade);
      setSummaryFacts(buildFacts(trade, priorTrades));
      setStage('analyzing');
      setTimeout(() => setStage('summary'), 700);
    }, 450);
  }

  function logAnother() {
    setForm(empty());
    setStage('idle');
  }

  function finish() {
    setStage('idle');
    setForm(empty());
    (onDone ?? onCancel)?.();
  }

  const rrColor = rr === null ? '#fff' : rr >= 2 ? '#22c55e' : rr >= 1 ? '#d4af37' : '#ef4444';
  const busy = stage !== 'idle';

  return (
    <div className="relative">
      <form
        onSubmit={handleSubmit}
        className={`space-y-6 transition-opacity duration-200 ${busy ? 'opacity-30 pointer-events-none' : ''}`}
        dir="ltr"
        aria-hidden={busy}
      >
        {/* ── Context — quiet, human framing, not another field ── */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#d4af37]/40 mb-1.5">New Entry</p>
          <p className="text-[13px] text-white/40 leading-relaxed">
            Document your latest trade — most entries take under a minute, and every one sharpens your edge.
          </p>
        </div>

        {/* ── WHEN — always visible; every trade needs a timestamp ── */}
        <Group label="When" tone="muted">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={inputCls} required />
            </Field>
            <Field label="Time">
              <input type="time" value={form.time} onChange={e => set('time', e.target.value)} className={inputCls} required />
            </Field>
          </div>
        </Group>

        {/* ── TRADE INFO ── */}
        <Group label="Trade">
          <Field label="Instrument">
            <div className="grid grid-cols-4 gap-1.5">
              {INSTRUMENT_KEYS.map(s => (
                <button type="button" key={s} onClick={() => set('symbol', s)}
                  title={INSTRUMENTS[s].label}
                  className={toggleBtn(form.symbol === s, 'border-[#d4af37]/60 bg-[#d4af37]/10 text-[#d4af37]')}>
                  {s}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Direction">
              <div className="flex gap-1.5">
                {(['LONG', 'SHORT'] as Direction[]).map(d => (
                  <button type="button" key={d} onClick={() => set('direction', d)}
                    className={toggleBtn(form.direction === d, d === 'LONG' ? 'border-[#22c55e]/60 bg-[#22c55e]/10 text-[#22c55e]' : 'border-[#ef4444]/60 bg-[#ef4444]/10 text-[#ef4444]')}>
                    {d}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Contracts">
              <input type="number" min={1} step="1" value={form.contracts} onChange={e => set('contracts', e.target.value)} placeholder="1" className={inputCls} required />
            </Field>
          </div>
        </Group>

        {/* ── EXECUTION — entry/stop/target, the resulting RR, and the outcome ── */}
        <Group label="Execution">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Entry">
              <input type="number" step="0.25" value={form.entry} onChange={e => set('entry', e.target.value)} placeholder="0.00" className={inputCls} required />
            </Field>
            <Field label="Stop Loss">
              <input type="number" step="0.25" value={form.stop} onChange={e => set('stop', e.target.value)} placeholder="0.00" className={inputCls} required />
            </Field>
            <Field label="Take Profit">
              <input type="number" step="0.25" value={form.target} onChange={e => set('target', e.target.value)} placeholder="0.00" className={inputCls} required />
            </Field>
          </div>

          {rr !== null && (
            <div className="flex items-center gap-4 px-4 py-3 rounded-xl bg-white/[0.02] transition-all duration-150">
              <div>
                <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">Planned RR</span>
                <span className="font-mono text-xl font-bold" style={{ color: rrColor }}>{rr.toFixed(2)}R</span>
              </div>
              {pnl !== null && (
                <>
                  <div className="h-8 w-px bg-white/[0.08]" />
                  <div>
                    <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">Gross P&L</span>
                    <span className="font-mono text-xl font-bold" style={{ color: pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                      {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toFixed(0)}
                    </span>
                  </div>
                </>
              )}
              {points !== null && (
                <>
                  <div className="h-8 w-px bg-white/[0.08]" />
                  <div>
                    <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">Points · Ticks</span>
                    <span className="font-mono text-sm font-bold text-white/70">
                      {points >= 0 ? '+' : ''}{points.toFixed(2)} · {ticks! >= 0 ? '+' : ''}{Math.round(ticks!)}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          <Field label="Result">
            <div className="flex gap-1.5">
              {(['OPEN', 'WIN', 'LOSS', 'BE'] as TradeResult[]).map(r => (
                <button
                  type="button"
                  key={r}
                  onClick={() => set('result', r)}
                  className={`flex-1 py-2 rounded-xl border font-mono text-[11px] font-bold uppercase tracking-[0.10em] transition-all duration-150 ${
                    form.result === r
                      ? r === 'WIN'  ? 'border-[#22c55e]/60 bg-[#22c55e]/10 text-[#22c55e]'
                      : r === 'LOSS' ? 'border-[#ef4444]/60 bg-[#ef4444]/10 text-[#ef4444]'
                      : r === 'BE'   ? 'border-[#d4af37]/60 bg-[#d4af37]/10 text-[#d4af37]'
                      :                'border-[#444] bg-[#1c1c1e] text-white/60'
                      : 'border-[#222] text-white/30 hover:text-white/60'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </Field>
        </Group>

        {/* ── SESSION — explicit, manual; critical for analytics ── */}
        <Group label="Session">
          <div className="flex gap-1.5">
            {SESS.map(s => (
              <button type="button" key={s.key} onClick={() => set('session', s.key)}
                className={toggleBtn(form.session === s.key, 'border-[#d4af37]/60 bg-[#d4af37]/10 text-[#d4af37]')}>
                {s.en}
              </button>
            ))}
          </div>
          {declaredBias && (
            <p className="font-mono text-[10px] text-white/30">
              Today&apos;s bias: <b className="text-white/60">{declaredBias}</b>{' '}
              {alignment === 'ALIGNED'
                ? <span className="text-[#22c55e]">✓ this trade is aligned</span>
                : <span className="text-[#d4af37]">⚠ this trade is counter-trend</span>}
            </p>
          )}
        </Group>

        {/* ── SCREENSHOT — encouraged, always visible ── */}
        <Group label="Screenshot" tone="muted">
          <ScreenshotUpload images={form.screenshots} onChange={s => set('screenshots', s)} />
        </Group>

        {/* ── REASONING — feeds the AI's pattern + psychology analysis ── */}
        <Group label="Reasoning" tone="muted">
          <div>
            <p className="text-[13px] text-white/55 mb-2 leading-snug" dir="rtl">מה גרם לך להיכנס לעסקה הזו?</p>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="תאר את ה-setup, מה ראית בשוק, ואיזה confirmation נתן לך ביטחון להיכנס..."
              className={inputCls + ' resize-none'}
              rows={3}
              dir="rtl"
            />
          </div>
        </Group>

        {/* ── Advanced — collapsed by default; model tag, picked from the Playbook ── */}
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white/22 hover:text-white/45 transition-colors duration-150"
        >
          <span
            className="inline-block transition-transform duration-200"
            style={{ transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            ▾
          </span>
          {showAdvanced ? 'Hide advanced fields' : 'Show advanced fields'}
        </button>

        {showAdvanced && (
          <div className="onyx-reveal space-y-5 pt-1 border-t border-white/[0.04]">
            <Field label="Model">
              {playbookSetups.length > 0 ? (
                <select value={form.model} onChange={e => set('model', e.target.value)} className={inputCls}>
                  <option value="">Unspecified</option>
                  {playbookSetups.map(s => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              ) : (
                <p className="font-mono text-xs text-white/30">
                  No setups in your Playbook yet —{' '}
                  <Link href="/dashboard/playbook" className="text-[#d4af37]/70 hover:text-[#d4af37] transition-colors">
                    define one
                  </Link>{' '}
                  to tag trades by model.
                </p>
              )}
            </Field>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            className="flex-1 py-3.5 rounded-xl font-mono text-sm font-bold uppercase tracking-[0.14em] transition-all duration-200 bg-[#d4af37] text-black hover:bg-[#e5c84a] hover:scale-[1.01] [box-shadow:0_0_24px_rgba(212,175,55,0.25)]"
          >
            Log Trade
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-6 py-3.5 rounded-xl border border-white/[0.06] text-white/40 font-mono text-sm uppercase tracking-[0.14em] hover:text-white/70 hover:border-white/15 transition-colors duration-150"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* ── Save flow overlay — saving → analyzed → immediate feedback ── */}
      {busy && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/65 backdrop-blur-[3px]" dir="ltr">
          <div key={stage} className="onyx-pop-in w-full max-w-sm px-6 py-8">

            {stage === 'saving' && (
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="w-9 h-9 rounded-full border-2 border-[#d4af37]/15 border-t-[#d4af37] animate-spin" />
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/35">Saving trade…</p>
              </div>
            )}

            {stage === 'analyzing' && (
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="w-9 h-9 rounded-full flex items-center justify-center border-2 border-[#22c55e]/30 bg-[#22c55e]/5">
                  <span className="text-[#22c55e] text-base leading-none">✓</span>
                </div>
                <p className="text-sm text-white/70">Trade recorded</p>
                <div className="flex items-center gap-2">
                  <TypingDots />
                  <span className="font-mono text-[11px] text-white/35">Onyx is analyzing the trade…</span>
                </div>
              </div>
            )}

            {stage === 'summary' && (
              <div className="space-y-5">
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center border-2 border-[#22c55e]/40 bg-[#22c55e]/5">
                    <span className="text-[#22c55e] text-lg leading-none">✓</span>
                  </div>
                  <p className="text-sm font-medium text-white/80">Trade logged successfully</p>
                </div>
                <ul className="space-y-2">
                  {summaryFacts.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 font-mono text-[11px] text-white/45 leading-relaxed">
                      <span className="text-[#d4af37]/50 mt-[1px]">›</span>{f}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={logAnother}
                    className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/55 hover:text-white hover:border-white/20 font-mono text-[11px] uppercase tracking-[0.12em] transition-all duration-150"
                  >
                    Log another
                  </button>
                  <button
                    type="button"
                    onClick={finish}
                    className="flex-1 py-2.5 rounded-xl bg-[#d4af37] text-black font-mono text-[11px] font-bold uppercase tracking-[0.12em] hover:bg-[#e5c84a] transition-all duration-150"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
