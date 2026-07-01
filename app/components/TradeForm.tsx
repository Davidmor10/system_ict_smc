'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { TradeEntry, Direction, TradeResult } from '../lib/journal';
import { todayISO } from '../lib/journal';
import { calcRR, calcPnL, calcRealizedR, calcPoints, calcTicks } from '../lib/calc/trade';
import { INSTRUMENT_KEYS, INSTRUMENTS, type InstrumentKey } from '../lib/instruments';
import { SESS, getActiveSessionKey, type SessionKey } from '../lib/sessions';
import { getTodaysDeclaredBias, computeBiasAlignment } from '../lib/dailyBias';
import ScreenshotUpload from './ScreenshotUpload';

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

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#d4af37]/60">{label}</span>
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

export default function TradeForm({
  onSave,
  onCancel,
}: {
  onSave: (trade: TradeEntry) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<FormState>(empty());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [playbookSetups, setPlaybookSetups] = useState<PlaybookSetup[]>([]);

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
    if (!form.entry || !form.stop || !form.target || justSaved) return;

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

    // Brief success moment before the form clears — reinforces that the entry mattered.
    setJustSaved(true);
    setTimeout(() => {
      onSave(trade);
      setForm(empty());
      setJustSaved(false);
    }, 650);
  }

  const rrColor = rr === null ? '#fff' : rr >= 2 ? '#22c55e' : rr >= 1 ? '#d4af37' : '#ef4444';

  return (
    <form onSubmit={handleSubmit} className="space-y-7" dir="ltr">

      {/* ── WHEN — always visible; every trade needs a timestamp ── */}
      <Group label="When">
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

      {/* ── EXECUTION ── */}
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
          <div className="flex items-center gap-4 px-4 py-3 rounded-xl border border-[#1c1c1e] bg-[#070708] transition-all duration-150">
            <div>
              <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">Planned RR</span>
              <span className="font-mono text-xl font-bold" style={{ color: rrColor }}>{rr.toFixed(2)}R</span>
            </div>
            {pnl !== null && (
              <>
                <div className="h-8 w-px bg-[#1c1c1e]" />
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
                <div className="h-8 w-px bg-[#1c1c1e]" />
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
      </Group>

      {/* ── RESULT ── */}
      <Group label="Result">
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
      <Group label="Screenshot">
        <ScreenshotUpload images={form.screenshots} onChange={s => set('screenshots', s)} />
      </Group>

      {/* ── OBSERVATIONS — feeds the AI's pattern + psychology analysis ── */}
      <Group label="Observations">
        <textarea
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="מה ראית בשוק שגרם לך להיכנס לעסקה הזו?"
          className={inputCls + ' resize-none'}
          rows={3}
          dir="rtl"
        />
      </Group>

      {/* ── Advanced — collapsed by default; model tag, picked from the Playbook ── */}
      <button
        type="button"
        onClick={() => setShowAdvanced(v => !v)}
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/30 hover:text-white/55 transition-colors duration-150"
      >
        {showAdvanced ? '▴ Hide advanced fields' : '▾ Show advanced fields'}
      </button>

      {showAdvanced && (
        <div className="space-y-5 pt-1 border-t border-[#1c1c1e]">
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
          disabled={justSaved}
          className={`flex-1 py-3.5 rounded-xl font-mono text-sm font-bold uppercase tracking-[0.14em] transition-all duration-200 ${
            justSaved
              ? 'bg-[#22c55e] text-black'
              : 'bg-[#d4af37] text-black hover:bg-[#e5c84a] hover:scale-[1.01] [box-shadow:0_0_24px_rgba(212,175,55,0.25)]'
          }`}
        >
          {justSaved ? '✓ Logged' : 'Log Trade'}
        </button>
        {onCancel && !justSaved && (
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-3.5 rounded-xl border border-[#1c1c1e] text-white/40 font-mono text-sm uppercase tracking-[0.14em] hover:text-white/70 hover:border-[#333] transition-colors duration-150"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
