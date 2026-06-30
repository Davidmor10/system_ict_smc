'use client';

import { useState, useEffect } from 'react';
import type { TradeEntry, Symbol, Direction, TradeResult } from '../lib/journal';
import { todayISO } from '../lib/journal';
import { calcRR, calcPnL, calcRealizedR } from '../lib/calc/trade';

const SYMBOLS: Symbol[] = ['ES', 'NQ'];
const SESSIONS = ['london', 'new_york', 'asia', 'overnight'];
const MOODS = [1, 2, 3, 4, 5] as const;
const MOOD_LABELS = ['😤', '😕', '😐', '🙂', '😊'];

interface FormState {
  symbol: Symbol;
  direction: Direction;
  date: string;
  time: string;
  entry: string;
  stop: string;
  target: string;
  result: TradeResult;
  model: string;
  session: string;
  mood: number;
  notes: string;
}

function empty(): FormState {
  const now = new Date();
  return {
    symbol: 'ES',
    direction: 'LONG',
    date: todayISO(),
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    entry: '',
    stop: '',
    target: '',
    result: 'OPEN',
    model: '',
    session: 'new_york',
    mood: 3,
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

export default function TradeForm({
  onSave,
  onCancel,
}: {
  onSave: (trade: TradeEntry) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<FormState>(empty());

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
      session: form.session,
      bias: 'INDECISIVE',
      model: form.model || 'Unspecified',
      notes: form.notes,
      tradeR: realizedR ?? undefined,
      pnlUsd: pnl ?? undefined,
      biasAlignment: 'ALIGNED',
    };
    onSave(trade);
    setForm(empty());
  }

  const rrColor = rr === null ? '#fff' : rr >= 2 ? '#22c55e' : rr >= 1 ? '#d4af37' : '#ef4444';

  return (
    <form onSubmit={handleSubmit} className="space-y-5" dir="ltr">

      {/* Row 1: Symbol + Direction */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Symbol">
          <div className="flex gap-1.5">
            {SYMBOLS.map(s => (
              <button
                type="button"
                key={s}
                onClick={() => set('symbol', s)}
                className={`flex-1 py-2 rounded-xl border font-mono text-sm font-bold transition-colors ${form.symbol === s ? 'border-[#d4af37]/60 bg-[#d4af37]/10 text-[#d4af37]' : 'border-[#222] text-white/40 hover:text-white/70'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Direction">
          <div className="flex gap-1.5">
            {(['LONG', 'SHORT'] as Direction[]).map(d => (
              <button
                type="button"
                key={d}
                onClick={() => set('direction', d)}
                className={`flex-1 py-2 rounded-xl border font-mono text-sm font-bold transition-colors ${form.direction === d ? (d === 'LONG' ? 'border-[#22c55e]/60 bg-[#22c55e]/10 text-[#22c55e]' : 'border-[#ef4444]/60 bg-[#ef4444]/10 text-[#ef4444]') : 'border-[#222] text-white/40 hover:text-white/70'}`}
              >
                {d}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {/* Row 2: Entry / SL / TP with live RR */}
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

      {/* Live RR display */}
      {rr !== null && (
        <div className="flex items-center gap-4 px-4 py-3 rounded-xl border border-[#1c1c1e] bg-[#070708]">
          <div>
            <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">Planned RR</span>
            <span className="font-mono text-xl font-bold" style={{ color: rrColor }}>
              {rr >= 0 ? '' : ''}{rr.toFixed(2)}R
            </span>
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

      {/* Row 3: Result + Setup */}
      <div className="grid grid-cols-2 gap-3">
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
        <Field label="Setup / Model">
          <input type="text" value={form.model} onChange={e => set('model', e.target.value)} placeholder="e.g. Reversal at PDH" className={inputCls} />
        </Field>
      </div>

      {/* Row 4: Session + Date + Time */}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Session">
          <select value={form.session} onChange={e => set('session', e.target.value)} className={inputCls + ' cursor-pointer'}>
            {SESSIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Date">
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Time">
          <input type="time" value={form.time} onChange={e => set('time', e.target.value)} className={inputCls} />
        </Field>
      </div>

      {/* Mood */}
      <Field label="Mood">
        <div className="flex gap-2">
          {MOODS.map((m, i) => (
            <button
              type="button"
              key={m}
              onClick={() => set('mood', m)}
              className={`flex-1 py-2 rounded-xl border text-lg transition-all ${form.mood === m ? 'border-[#d4af37]/50 bg-[#d4af37]/5 scale-110' : 'border-[#1c1c1e] opacity-40 hover:opacity-70'}`}
            >
              {MOOD_LABELS[i]}
            </button>
          ))}
        </div>
      </Field>

      {/* Notes */}
      <Field label="Notes">
        <textarea
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="מה קרה בעסקה? מה ראית? מה הרגשת?"
          className={inputCls + ' resize-none'}
          rows={3}
          dir="rtl"
        />
      </Field>

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          className="flex-1 py-3 rounded-xl bg-[#d4af37] text-black font-mono text-sm font-bold uppercase tracking-[0.14em] hover:bg-[#e5c84a] transition-colors [box-shadow:0_0_24px_rgba(212,175,55,0.25)]"
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
