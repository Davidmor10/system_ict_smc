'use client';

import { useState } from 'react';
import type { TradeEntry, Symbol, Direction, TradeResult, Setup, IFVGConfirmation } from '../lib/journal';
import { todayISO } from '../lib/journal';
import { calcRR, calcPnL, calcRealizedR } from '../lib/calc/trade';
import { SESS, getActiveSessionKey, type SessionKey } from '../lib/sessions';
import { getTodaysDeclaredBias, computeBiasAlignment } from '../lib/dailyBias';

const SYMBOLS: Symbol[] = ['ES', 'NQ'];
const SETUPS: Setup[] = ['REVERSAL', 'CONTINUATION'];
const CONFIRMATIONS: IFVGConfirmation[] = ['IFVG_1M', 'IFVG_2M', 'IFVG_3M', 'IFVG_5M'];

/* ── Every field below maps to a specific future insight. Nothing here is decorative:
   symbol/direction/setup/result → win-rate-by-setup breakdowns
   entry/stop/target            → RR distribution, planned-vs-realized edge
   session (auto)               → win-rate-by-session (already surfaced in the AI coach)
   bias alignment (auto)        → the Discipline Score on the dashboard hero
   confirmation/model           → fractal-engine confluence performance (the core product thesis)
   notes                        → fed into the AI's pattern + psychology analysis           ── */

interface FormState {
  symbol: Symbol;
  direction: Direction;
  setup: Setup;
  date: string;
  time: string;
  entry: string;
  stop: string;
  target: string;
  result: TradeResult;
  confirmation: IFVGConfirmation;
  model: string;
  session: SessionKey | '';
  notes: string;
}

function empty(): FormState {
  const now = new Date();
  return {
    symbol: 'ES',
    direction: 'LONG',
    setup: 'REVERSAL',
    date: todayISO(),
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    entry: '',
    stop: '',
    target: '',
    result: 'OPEN',
    confirmation: 'IFVG_2M',
    model: '',
    session: getActiveSessionKey() ?? '',
    notes: '',
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-white/40 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full bg-[#111] border border-[#222] rounded-xl px-3 py-2 font-mono text-sm text-white placeholder-white/20 outline-none focus:border-[#d4af37]/50 transition-colors tabular-nums';
const toggleBtn = (active: boolean, activeCls: string) =>
  `flex-1 py-2 rounded-xl border font-mono text-sm font-bold transition-colors ${active ? activeCls : 'border-[#222] text-white/40 hover:text-white/70'}`;

export default function TradeForm({
  onSave,
  onCancel,
}: {
  onSave: (trade: TradeEntry) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<FormState>(empty());
  const [showAdvanced, setShowAdvanced] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const entry  = parseFloat(form.entry);
  const stop   = parseFloat(form.stop);
  const target = parseFloat(form.target);

  const rr = (isFinite(entry) && isFinite(stop) && isFinite(target))
    ? calcRR(entry, stop, target)
    : null;

  const pnl = (form.result !== 'OPEN' && form.result !== 'BE' && isFinite(entry) && isFinite(stop) && isFinite(target))
    ? calcPnL(entry, form.result === 'WIN' ? target : stop, form.direction, form.symbol)
    : form.result === 'BE' ? 0 : null;

  const realizedR = (form.result !== 'OPEN' && isFinite(entry) && isFinite(stop))
    ? (form.result === 'WIN' && isFinite(target) ? calcRealizedR(entry, target, stop, form.direction)
      : form.result === 'LOSS' ? calcRealizedR(entry, stop, stop, form.direction)
      : 0)
    : null;

  // Auto-derived context — never asked, always computed.
  const declaredBias = getTodaysDeclaredBias();
  const alignment = computeBiasAlignment(declaredBias, form.direction);
  const sessionLabel = SESS.find(s => s.key === form.session)?.en;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.entry || !form.stop || !form.target) return;

    const trade: TradeEntry = {
      id: Date.now(),
      dateISO: form.date,
      time: form.time,
      symbol: form.symbol,
      direction: form.direction,
      entry,
      stop,
      target,
      result: form.result,
      session: form.session || 'NONE',
      bias: declaredBias ?? 'INDECISIVE',
      model: form.model || 'Unspecified',
      setup: form.setup,
      confirmation: form.confirmation,
      notes: form.notes,
      tradeR: realizedR ?? undefined,
      pnlUsd: pnl ?? undefined,
      biasAlignment: alignment,
    };
    onSave(trade);
    setForm(empty());
  }

  const rrColor = rr === null ? '#fff' : rr >= 2 ? '#22c55e' : rr >= 1 ? '#d4af37' : '#ef4444';

  return (
    <form onSubmit={handleSubmit} className="space-y-5" dir="ltr">

      {/* ── TRADE INFO: symbol / direction / setup — one click each ── */}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Symbol">
          <div className="flex gap-1.5">
            {SYMBOLS.map(s => (
              <button type="button" key={s} onClick={() => set('symbol', s)}
                className={toggleBtn(form.symbol === s, 'border-[#d4af37]/60 bg-[#d4af37]/10 text-[#d4af37]')}>
                {s}
              </button>
            ))}
          </div>
        </Field>
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
        <Field label="Setup">
          <div className="flex gap-1.5">
            {SETUPS.map(s => (
              <button type="button" key={s} onClick={() => set('setup', s)}
                className={toggleBtn(form.setup === s, 'border-[#d4af37]/60 bg-[#d4af37]/10 text-[#d4af37]')}>
                {s === 'REVERSAL' ? 'Reversal' : 'Continuation'}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {/* ── EXECUTION: entry / SL / TP with live RR ── */}
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
        <div className="flex items-center gap-4 px-4 py-3 rounded-xl border border-[#1c1c1e] bg-[#070708]">
          <div>
            <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">Planned RR</span>
            <span className="font-mono text-xl font-bold" style={{ color: rrColor }}>{rr.toFixed(2)}R</span>
          </div>
          {pnl !== null && (
            <>
              <div className="h-8 w-px bg-[#1c1c1e]" />
              <div>
                <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">Est. P&L</span>
                <span className="font-mono text-xl font-bold" style={{ color: pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                  {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toFixed(0)}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Result ── */}
      <Field label="Result">
        <div className="flex gap-1">
          {(['OPEN', 'WIN', 'LOSS', 'BE'] as TradeResult[]).map(r => (
            <button
              type="button"
              key={r}
              onClick={() => set('result', r)}
              className={`flex-1 py-1.5 rounded-xl border font-mono text-[10px] font-bold uppercase tracking-[0.10em] transition-colors ${
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

      {/* ── AUTO CONTEXT — derived, not asked. Feeds the discipline score + session insights. ── */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-3 rounded-xl border border-[#1c1c1e] bg-[#070708]">
        <span className="font-mono text-[10px] text-white/40">
          Session: <b className="text-white/80">{sessionLabel ?? '—'}</b>
        </span>
        <span className="text-white/15">·</span>
        <span className="font-mono text-[10px] text-white/40">
          {declaredBias ? (
            <>Today&apos;s bias: <b className="text-white/80">{declaredBias}</b>{' '}
              {alignment === 'ALIGNED'
                ? <span className="text-[#22c55e]">✓ aligned</span>
                : <span className="text-[#d4af37]">⚠ counter-trend</span>}
            </>
          ) : (
            <span className="text-white/25">No bias declared today — set one on the dashboard</span>
          )}
        </span>
      </div>

      {/* ── Notes — optional, but feeds the AI's pattern + psychology analysis ── */}
      <Field label="Notes (optional)">
        <textarea
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="מה קרה בעסקה? מה ראית? מה הרגשת?"
          className={inputCls + ' resize-none'}
          rows={3}
          dir="rtl"
        />
      </Field>

      {/* ── Advanced — collapsed by default; confirmation timeframe, model label, manual overrides ── */}
      <button
        type="button"
        onClick={() => setShowAdvanced(v => !v)}
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/30 hover:text-white/60 transition-colors"
      >
        {showAdvanced ? '▴ Hide advanced fields' : '▾ Show advanced fields'}
      </button>

      {showAdvanced && (
        <div className="space-y-4 pt-1 border-t border-[#1c1c1e]">
          <Field label="IFVG Confirmation">
            <div className="flex gap-1.5">
              {CONFIRMATIONS.map(c => (
                <button type="button" key={c} onClick={() => set('confirmation', c)}
                  className={toggleBtn(form.confirmation === c, 'border-[#d4af37]/60 bg-[#d4af37]/10 text-[#d4af37]')}>
                  {c.replace('IFVG_', '')}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Model Label">
            <input type="text" value={form.model} onChange={e => set('model', e.target.value)} placeholder="e.g. Reversal at PDH" className={inputCls} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Session override">
              <select value={form.session} onChange={e => set('session', e.target.value as SessionKey)} className={inputCls + ' cursor-pointer'}>
                <option value="">—</option>
                {SESS.map(s => <option key={s.key} value={s.key}>{s.en}</option>)}
              </select>
            </Field>
            <Field label="Date">
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Time">
              <input type="time" value={form.time} onChange={e => set('time', e.target.value)} className={inputCls} />
            </Field>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          className="flex-1 py-3 rounded-xl bg-[#d4af37] text-black font-mono text-sm font-bold uppercase tracking-[0.14em] hover:bg-[#e5c84a] transition-all duration-200 hover:scale-[1.01] [box-shadow:0_0_24px_rgba(212,175,55,0.25)]"
        >
          Log Trade
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-3 rounded-xl border border-[#1c1c1e] text-white/40 font-mono text-sm uppercase tracking-[0.14em] hover:text-white/70 hover:border-[#333] transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
