'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { TradeEntry, Direction, TradeResult, EmotionalState } from '../lib/journal';
import { todayISO, computeStats, UNSPECIFIED_MODEL } from '../lib/journal';
import { calcRR, calcMultiExitPnL, calcMultiExitRealizedR, calcWeightedExitPrice, inferResult } from '../lib/calc/trade';
import { INSTRUMENT_KEYS, INSTRUMENTS, type InstrumentKey } from '../lib/instruments';
import { SESS, sessionForHour, getActiveSessionKey, type SessionKey } from '../lib/sessions';
import { analyzeInstruments, isoWeekKey, normSession } from '../lib/analytics';
import { getTodaysDeclaredBias, computeBiasAlignment } from '../lib/dailyBias';
import ScreenshotUpload from './ScreenshotUpload';
import TypingDots from './TypingDots';
import { checkTrade, type GuardianWarning } from '../lib/guardian/checkTrade';

const PLAYBOOK_STORAGE_KEY = 'onyx_playbook';

const DIRECTION_HE: Record<Direction, string> = { LONG: 'לונג', SHORT: 'שורט' };
const RESULT_HE: Record<TradeResult, string> = { OPEN: 'פתוחה', WIN: 'פרופיט', LOSS: 'הפסד', BE: 'ברייק איוון' };
const BIAS_HE: Record<string, string> = { BULLISH: 'עולה', BEARISH: 'יורד', INDECISIVE: 'ניטרלי' };

// The four the app ships with. Traders add their own on top of these (persisted
// per-device in localStorage) — the field is stored as free `string[]`, so a
// custom tag like "Silver Bullet" is a first-class confirmation just like these.
const DEFAULT_CONFIRMATIONS = ['SMT', 'IFVG', 'CISD', 'ORDER_BLOCK'] as const;
const CONFIRMATION_LABELS: Record<string, string> = { ORDER_BLOCK: 'Order Block' };
const labelForConfirmation = (tag: string) => CONFIRMATION_LABELS[tag] ?? tag;

const CONFIRMATIONS_STORAGE_KEY = 'onyx_confirmations';

function loadCustomConfirmations(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CONFIRMATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string' && s.length > 0) : [];
  } catch {
    return [];
  }
}

function saveCustomConfirmations(list: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CONFIRMATIONS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota/serialization errors — custom tags are a convenience, not critical state */
  }
}

const EMOTIONAL_STATE_OPTIONS: { key: EmotionalState; label: string }[] = [
  { key: 'CALM', label: 'רגוע' },
  { key: 'CONFIDENT', label: 'בטוח' },
  { key: 'STRESSED', label: 'לחוץ' },
  { key: 'FOMO', label: 'FOMO' },
  { key: 'TIRED', label: 'עייף' },
  { key: 'ANGRY', label: 'כועס' },
  { key: 'IMPATIENT', label: 'חסר סבלנות' },
];

interface PlaybookSetup { id: string; name: string; deleted?: boolean }

function loadPlaybookSetups(): PlaybookSetup[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PLAYBOOK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // The playbook store now keeps soft-delete tombstones for cross-device sync —
    // never offer a deleted setup in the picker.
    return Array.isArray(parsed) ? parsed.filter((s): s is PlaybookSetup => !!s?.name && !s?.deleted) : [];
  } catch {
    return [];
  }
}

/* ── Every field maps to a specific future insight:
   instrument/contracts/direction/exits → win-rate + gross-PnL breakdowns, realized PnL/R, exit behavior
   entry/stop/target                    → planned RR, planned-vs-realized edge
   session (auto-detected)              → win-rate-by-session (drives the AI coach)
   bias alignment (auto)                → the Discipline Score on the dashboard hero
   model                                → picked from the Playbook; drives per-model performance analytics
   confirmations                        → which entry-confirmation combos actually work over time
   emotional state                      → how emotion at entry correlates with results
   screenshots/notes                    → fed into the AI's pattern + psychology analysis
   Nothing here is asked if the system can already compute it — result and session are
   both derived, never chosen. PnL is never typed in by hand either. ── */

interface ExitRow { price: string; contracts: string; }

interface FormState {
  symbol: InstrumentKey;
  contracts: string;
  direction: Direction;
  date: string;
  time: string;
  entry: string;
  stop: string;
  target: string;
  exits: ExitRow[];
  confirmations: string[];
  emotionalState: EmotionalState | '';
  model: string;
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
    exits: [],
    confirmations: [],
    emotionalState: '',
    model: '',
    notes: '',
    screenshots: [],
  };
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
      const label = SESS.find(s => s.key === trade.session)?.he ?? trade.session;
      return `זו העסקה ה-${sessionThisWeek.length} שלך השבוע בסשן ${label}. אחוז ההצלחה הנוכחי בסשן: ${winRate}%.`;
    }
  }

  const strongInstruments = analyzeInstruments(allTrades).filter(g => g.confidence.level !== 'low');
  if (strongInstruments.length > 0) {
    const best = strongInstruments.reduce((a, b) => (b.winRate > a.winRate ? b : a));
    return `${best.key} עדיין המכשיר הכי חזק שלך מבחינת אחוז הצלחה (${best.winRate.toFixed(0)}%).`;
  }

  return null;
}

/** Short, immediate feedback lines shown right after a trade is logged — not a deep
    review, just proof the system did something with the entry. */
function buildFacts(trade: TradeEntry, priorTrades: TradeEntry[]): string[] {
  const facts: string[] = [];
  const allTrades = [trade, ...priorTrades];

  if (trade.session && trade.session !== 'NONE') {
    const label = SESS.find(s => s.key === trade.session)?.he ?? trade.session;
    facts.push(`זוהה אוטומטית כמושב ${label}.`);
  }

  const rr = calcRR(trade.entry, trade.stop, trade.target);
  if (rr !== null) facts.push(`ה-RR המתוכנן חושב אוטומטית: ${rr.toFixed(2)}R.`);

  if (trade.result === 'OPEN') {
    facts.push('סומנה כפתוחה — הוסף יציאה כשהעסקה תיסגר.');
  } else {
    const after = computeStats(allTrades);
    facts.push(`אחוז ההצלחה התעדכן ל-${after.winRate.toFixed(0)}%.`);
  }

  facts.push(trade.biasAlignment === 'ALIGNED' ? 'מיושרת עם הביאס של היום.' : 'נרשמה כנגד המגמה, לשים לב.');

  if (trade.confirmations && trade.confirmations.length > 0) {
    facts.push(`תויגה עם ${trade.confirmations.length} אישורי כניסה: ${trade.confirmations.join(', ')}.`);
  }

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
const chipBtn = (active: boolean) =>
  `py-2 px-3.5 rounded-lg border font-mono text-xs font-semibold transition-all duration-150 ${
    active ? 'border-[#d4af37]/60 bg-[#d4af37]/10 text-[#d4af37]' : 'border-[#222] text-white/40 hover:text-white/70 hover:border-[#2a2a2d]'
  }`;

type SaveStage = 'idle' | 'saving' | 'analyzing' | 'summary';

/** Parses an "HH:MM..." string into a fractional hour, or null if malformed. */
function parseHour(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
}

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
  const [playbookSetups, setPlaybookSetups] = useState<PlaybookSetup[]>([]);
  const [customConfirmations, setCustomConfirmations] = useState<string[]>([]);
  const [newConfirmation, setNewConfirmation] = useState('');
  const [stage, setStage] = useState<SaveStage>('idle');
  const [summaryFacts, setSummaryFacts] = useState<string[]>([]);
  const [guardWarnings, setGuardWarnings] = useState<GuardianWarning[]>([]);

  useEffect(() => {
    setPlaybookSetups(loadPlaybookSetups());
    setCustomConfirmations(loadCustomConfirmations());
  }, []);

  // Defaults first, then whatever the trader has added — de-duplicated so a
  // custom tag can never shadow a built-in one.
  const availableConfirmations = [
    ...DEFAULT_CONFIRMATIONS,
    ...customConfirmations.filter(c => !DEFAULT_CONFIRMATIONS.includes(c as typeof DEFAULT_CONFIRMATIONS[number])),
  ];

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

  // ── Exits — derives result/PnL/R automatically instead of asking for them ──
  const parsedExits = form.exits
    .map(e => ({ price: parseFloat(e.price), contracts: parseInt(e.contracts, 10) || 0 }))
    .filter(e => isFinite(e.price) && e.contracts > 0);
  const hasExits = parsedExits.length > 0;
  const totalExitContracts = parsedExits.reduce((s, e) => s + e.contracts, 0);
  const remainingContracts = Math.max(0, contracts - totalExitContracts);

  const weightedExitPrice = hasExits ? calcWeightedExitPrice(parsedExits) : null;
  const realizedPnl = hasExits && isFinite(entry) ? calcMultiExitPnL(entry, parsedExits, form.direction, form.symbol) : null;
  const realizedR = hasExits && isFinite(entry) && isFinite(stop) ? calcMultiExitRealizedR(entry, stop, parsedExits, form.direction) : null;

  const derivedResult: TradeResult = (hasExits && isFinite(entry) && isFinite(stop) && weightedExitPrice !== null)
    ? inferResult(entry, stop, isFinite(target) ? target : null, weightedExitPrice, form.direction)
    : 'OPEN';

  function addExit() {
    setForm(prev => ({ ...prev, exits: [...prev.exits, { price: '', contracts: String(remainingContracts || contracts) }] }));
  }
  function removeExit(i: number) {
    setForm(prev => ({ ...prev, exits: prev.exits.filter((_, idx) => idx !== i) }));
  }
  function setExit(i: number, field: keyof ExitRow, value: string) {
    setForm(prev => ({ ...prev, exits: prev.exits.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)) }));
  }
  function toggleConfirmation(tag: string) {
    setForm(prev => ({
      ...prev,
      confirmations: prev.confirmations.includes(tag) ? prev.confirmations.filter(c => c !== tag) : [...prev.confirmations, tag],
    }));
  }
  function addCustomConfirmation() {
    const tag = newConfirmation.trim();
    if (!tag) return;
    setNewConfirmation('');
    // Case-insensitive dedupe against everything already offered; if it exists,
    // just make sure it's selected rather than adding a near-duplicate.
    const existing = availableConfirmations.find(c => c.toLowerCase() === tag.toLowerCase());
    if (existing) {
      setForm(prev => ({ ...prev, confirmations: prev.confirmations.includes(existing) ? prev.confirmations : [...prev.confirmations, existing] }));
      return;
    }
    const updated = [...customConfirmations, tag];
    setCustomConfirmations(updated);
    saveCustomConfirmations(updated);
    setForm(prev => ({ ...prev, confirmations: [...prev.confirmations, tag] }));
  }
  function removeCustomConfirmation(tag: string) {
    const updated = customConfirmations.filter(c => c !== tag);
    setCustomConfirmations(updated);
    saveCustomConfirmations(updated);
    setForm(prev => ({ ...prev, confirmations: prev.confirmations.filter(c => c !== tag) }));
  }
  function selectModel(name: string) {
    setForm(prev => ({ ...prev, model: prev.model === name ? '' : name }));
  }
  function setEmotionalState(state: EmotionalState) {
    setForm(prev => ({ ...prev, emotionalState: prev.emotionalState === state ? '' : state }));
  }

  // Auto-derived — no extra click, just shown as context.
  const entryHour: number | null = parseHour(form.time);
  const autoSession: SessionKey | null = entryHour !== null ? sessionForHour(entryHour) : getActiveSessionKey();
  const declaredBias = getTodaysDeclaredBias();
  const alignment = computeBiasAlignment(declaredBias, form.direction);

  /** Builds the trade record and runs the save animation flow. Called either
      directly (no warnings) or after the trader dismisses the guardian panel. */
  function performSave() {
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
      result: derivedResult,
      session: autoSession ?? 'NONE',
      bias: declaredBias ?? 'INDECISIVE',
      model: form.model || UNSPECIFIED_MODEL,
      notes: form.notes,
      screenshots: form.screenshots.length ? form.screenshots : undefined,
      exits: hasExits ? parsedExits : undefined,
      confirmations: form.confirmations.length ? form.confirmations : undefined,
      emotionalState: form.emotionalState || undefined,
      tradeR: realizedR ?? undefined,
      pnlUsd: realizedPnl ?? undefined,
      biasAlignment: alignment,
    };

    const priorTrades = trades;
    setGuardWarnings([]);

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.entry || !form.stop || !form.target || stage !== 'idle') return;

    // Discipline guardian — surface any evidence-backed concern before saving.
    // Never blocks: if warnings exist, show them and let the trader decide.
    const warnings = checkTrade(
      { symbol: form.symbol, direction: form.direction, session: autoSession, emotionalState: form.emotionalState || undefined, biasAlignment: alignment },
      trades,
      todayISO(),
    );
    if (warnings.length > 0) {
      setGuardWarnings(warnings);
      return;
    }
    performSave();
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
  const resultColor = derivedResult === 'WIN' ? '#22c55e' : derivedResult === 'LOSS' ? '#ef4444' : derivedResult === 'BE' ? '#d4af37' : 'rgba(255,255,255,0.5)';
  const busy = stage !== 'idle';

  return (
    <div className="relative">
      <form
        onSubmit={handleSubmit}
        className={`space-y-6 transition-opacity duration-200 ${busy ? 'opacity-30 pointer-events-none' : ''}`}
        dir="rtl"
        aria-hidden={busy}
      >
        {/* ── Context — quiet, human framing, not another field ── */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#d4af37]/40 mb-1.5">עסקה חדשה</p>
          <p className="text-[13px] text-white/40 leading-relaxed">
            תעד את העסקה האחרונה שלך — כל רישום לוקח פחות מדקה, וכל עסקה מחדדת את היתרון שלך.
          </p>
        </div>

        {/* ── WHEN — always visible; every trade needs a timestamp ── */}
        <Group label="מתי" tone="muted">
          <div className="grid grid-cols-2 gap-3">
            <Field label="תאריך">
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={inputCls} required />
            </Field>
            <Field label="שעת כניסה">
              <input type="time" value={form.time} onChange={e => set('time', e.target.value)} className={inputCls} required />
            </Field>
          </div>
        </Group>

        {/* ── TRADE INFO ── */}
        <Group label="פרטי העסקה">
          <Field label="נכס">
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
            <Field label="כיוון">
              <div className="flex gap-1.5">
                {(['LONG', 'SHORT'] as Direction[]).map(d => (
                  <button type="button" key={d} onClick={() => set('direction', d)}
                    className={toggleBtn(form.direction === d, d === 'LONG' ? 'border-[#22c55e]/60 bg-[#22c55e]/10 text-[#22c55e]' : 'border-[#ef4444]/60 bg-[#ef4444]/10 text-[#ef4444]')}>
                    {DIRECTION_HE[d]}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="חוזים">
              <input type="number" min={1} step="1" value={form.contracts} onChange={e => set('contracts', e.target.value)} placeholder="1" className={inputCls} required />
            </Field>
          </div>
        </Group>

        {/* ── EXECUTION — entry/stop/target and the planned RR ── */}
        <Group label="ביצוע">
          <div className="grid grid-cols-3 gap-3">
            <Field label="כניסה">
              <input type="number" step="0.25" value={form.entry} onChange={e => set('entry', e.target.value)} placeholder="0.00" className={inputCls} required />
            </Field>
            <Field label="סטופ">
              <input type="number" step="0.25" value={form.stop} onChange={e => set('stop', e.target.value)} placeholder="0.00" className={inputCls} required />
            </Field>
            <Field label="יעד">
              <input type="number" step="0.25" value={form.target} onChange={e => set('target', e.target.value)} placeholder="0.00" className={inputCls} required />
            </Field>
          </div>

          {rr !== null && (
            <div className="flex items-center gap-4 px-4 py-3 rounded-xl bg-white/[0.02] transition-all duration-150">
              <div>
                <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">RR מתוכנן</span>
                <span className="font-mono text-xl font-bold" style={{ color: rrColor }}>{rr.toFixed(2)}R</span>
              </div>
            </div>
          )}
        </Group>

        {/* ── EXITS — one or more; result/PnL/R are derived, never chosen ── */}
        <Group label="יציאות">
          {form.exits.length === 0 ? (
            <p className="font-mono text-[11px] text-white/25 leading-relaxed">
              אין עדיין יציאות רשומות — העסקה תישמר כפתוחה. הוסף יציאה (חלקית או מלאה) כשתסגור אותה.
            </p>
          ) : (
            <div className="space-y-2">
              {form.exits.map((exitRow, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="number" step="0.25" placeholder="מחיר יציאה"
                    value={exitRow.price} onChange={e => setExit(i, 'price', e.target.value)}
                    className={inputCls}
                  />
                  <input
                    type="number" min={1} step="1" placeholder="חוזים"
                    value={exitRow.contracts} onChange={e => setExit(i, 'contracts', e.target.value)}
                    className={inputCls + ' max-w-[92px]'}
                  />
                  <button
                    type="button" onClick={() => removeExit(i)}
                    aria-label="הסר יציאה"
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-white/25 hover:text-[#ef4444] transition-colors duration-150"
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={addExit}
            className="font-mono text-xs text-[#d4af37]/70 hover:text-[#d4af37] transition-colors duration-150"
          >
            ➕ הוסף יציאה נוספת
          </button>

          {hasExits && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 rounded-xl bg-white/[0.02]">
              <div>
                <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">רווח/הפסד ממומש</span>
                <span className="font-mono text-lg font-bold" style={{ color: (realizedPnl ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                  {realizedPnl !== null ? `${realizedPnl >= 0 ? '+' : ''}$${Math.abs(realizedPnl).toFixed(0)}` : '—'}
                </span>
              </div>
              <div className="h-8 w-px bg-white/[0.08]" />
              <div>
                <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">R ממומש</span>
                <span className="font-mono text-lg font-bold text-white/80">{realizedR !== null ? `${realizedR.toFixed(2)}R` : '—'}</span>
              </div>
              <div className="h-8 w-px bg-white/[0.08]" />
              <div>
                <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">תוצאה</span>
                <span className="font-mono text-sm font-bold" style={{ color: resultColor }}>{RESULT_HE[derivedResult]}</span>
              </div>
              {remainingContracts > 0 && (
                <>
                  <div className="h-8 w-px bg-white/[0.08]" />
                  <div>
                    <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">חוזים פתוחים</span>
                    <span className="font-mono text-sm font-bold text-white/60">{remainingContracts}</span>
                  </div>
                </>
              )}
            </div>
          )}
        </Group>

        {/* ── MODEL / SETUP — the trader's own playbook models, sitting right beside
            the generic confirmations so they can tag which of their built setups
            this entry belonged to. Single-select. ── */}
        <Group label="מודל / סטאפ" tone="muted">
          {playbookSetups.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {playbookSetups.map(s => (
                <button
                  type="button" key={s.id}
                  onClick={() => selectModel(s.name)}
                  className={chipBtn(form.model === s.name)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="font-mono text-[11px] text-white/30 leading-relaxed">
              עדיין לא בנית מודלים משלך —{' '}
              <Link href="/dashboard/playbook" className="text-[#d4af37]/70 hover:text-[#d4af37] transition-colors">
                בנה מודל בפלייבוק
              </Link>{' '}
              עם האישורים שלך, והוא יופיע כאן לבחירה.
            </p>
          )}
        </Group>

        {/* ── CONFIRMATIONS — built-in defaults + the trader's own tags, multi-select ── */}
        <Group label="אישורי הכניסה" tone="muted">
          <div className="flex flex-wrap gap-1.5">
            {availableConfirmations.map(tag => {
              const isCustom = !DEFAULT_CONFIRMATIONS.includes(tag as typeof DEFAULT_CONFIRMATIONS[number]);
              return (
                <span key={tag} className="relative group/conf">
                  <button
                    type="button"
                    onClick={() => toggleConfirmation(tag)}
                    className={chipBtn(form.confirmations.includes(tag))}
                    dir="ltr"
                  >
                    {labelForConfirmation(tag)}
                  </button>
                  {isCustom && (
                    <button
                      type="button"
                      onClick={() => removeCustomConfirmation(tag)}
                      aria-label={`מחק את האישור ${tag}`}
                      className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-black border border-[#333] text-white/50 text-[9px] flex items-center justify-center opacity-0 group-hover/conf:opacity-100 hover:text-[#ef4444] hover:border-[#ef4444]/60 transition-all duration-150"
                    >✕</button>
                  )}
                </span>
              );
            })}
          </div>
          <div className="flex gap-2 max-w-xs">
            <input
              value={newConfirmation}
              onChange={e => setNewConfirmation(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomConfirmation(); } }}
              placeholder="הוסף אישור משלך..."
              className={inputCls}
              dir="rtl"
            />
            <button
              type="button"
              onClick={addCustomConfirmation}
              aria-label="הוסף אישור"
              className="shrink-0 px-4 rounded-xl border border-[#d4af37]/30 text-[#d4af37]/70 hover:text-[#d4af37] hover:border-[#d4af37]/50 font-mono text-lg leading-none transition-colors duration-150"
            >＋</button>
          </div>
        </Group>

        {/* ── EMOTIONAL STATE — single select ── */}
        <Group label="מצב רגשי לפני הכניסה" tone="muted">
          <div className="flex flex-wrap gap-1.5">
            {EMOTIONAL_STATE_OPTIONS.map(opt => (
              <button
                type="button" key={opt.key}
                onClick={() => setEmotionalState(opt.key)}
                className={chipBtn(form.emotionalState === opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Group>

        {/* ── Auto-detected context — informational only, nothing to choose ── */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-white/30">
          <span>
            מושב מזוהה אוטומטית: <b className="text-white/60">{autoSession ? (SESS.find(s => s.key === autoSession)?.he ?? autoSession) : 'מחוץ לשעות מסחר'}</b>
          </span>
          {declaredBias && (
            <span>
              הביאס של היום: <b className="text-white/60">{BIAS_HE[declaredBias] ?? declaredBias}</b>{' '}
              {alignment === 'ALIGNED'
                ? <span className="text-[#22c55e]">✓ מיושר</span>
                : <span className="text-[#d4af37]">⚠ נגד המגמה</span>}
            </span>
          )}
        </div>

        {/* ── SCREENSHOT — encouraged, always visible ── */}
        <Group label="צילום מסך" tone="muted">
          <ScreenshotUpload images={form.screenshots} onChange={s => set('screenshots', s)} />
        </Group>

        {/* ── REASONING — feeds the AI's pattern + psychology analysis ── */}
        <Group label="נימוק" tone="muted">
          <div>
            <p className="text-[13px] text-white/55 mb-2 leading-snug" dir="rtl">מה גרם לך להיכנס לעסקה הזו?</p>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="תאר את ה-setup, מה ראית בשוק, ומה עבר עליך מבחינה מנטלית..."
              className={inputCls + ' resize-none'}
              rows={3}
              dir="rtl"
            />
          </div>
        </Group>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            className="flex-1 py-3.5 rounded-xl font-mono text-sm font-bold uppercase tracking-[0.14em] transition-all duration-200 bg-[#d4af37] text-black hover:bg-[#e5c84a] hover:scale-[1.01] [box-shadow:0_0_24px_rgba(212,175,55,0.25)]"
          >
            שמור עסקה
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-6 py-3.5 rounded-xl border border-white/[0.06] text-white/40 font-mono text-sm uppercase tracking-[0.14em] hover:text-white/70 hover:border-white/15 transition-colors duration-150"
            >
              ביטול
            </button>
          )}
        </div>
      </form>

      {/* ── Discipline Guardian — evidence-backed pre-save warnings; never blocks ── */}
      {guardWarnings.length > 0 && stage === 'idle' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-black/70 backdrop-blur-[3px] p-4" dir="rtl">
          <div className="onyx-pop-in w-full max-w-md rounded-2xl border border-[#d4af37]/25 bg-[#0a0a0b] p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <span className="text-[#d4af37] text-lg leading-none">⚠</span>
              <h3 className="font-serif text-lg font-bold text-white">רגע לפני ששומרים</h3>
            </div>
            <p className="text-[13px] text-white/45 mb-4 leading-relaxed">
              לפי הנתונים שלך, שווה לשים לב לדברים הבאים. ההחלטה בידיים שלך.
            </p>
            <ul className="space-y-2.5 mb-6">
              {guardWarnings.map(w => (
                <li key={w.id} className="flex items-start gap-2.5">
                  <span className="mt-[3px] shrink-0" style={{ color: w.severity === 'high' ? '#ef4444' : w.severity === 'caution' ? '#d4af37' : 'rgba(255,255,255,0.4)' }}>●</span>
                  <span className="text-[13.5px] text-white/75 leading-relaxed">{w.text}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setGuardWarnings([])}
                className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 hover:text-white hover:border-white/20 font-mono text-[12px] font-bold uppercase tracking-[0.12em] transition-all duration-150"
              >
                חזור ובדוק
              </button>
              <button
                type="button"
                onClick={performSave}
                className="flex-1 py-3 rounded-xl bg-[#d4af37]/90 text-black hover:bg-[#d4af37] font-mono text-[12px] font-bold uppercase tracking-[0.12em] transition-all duration-150"
              >
                שמור בכל זאת
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Save flow overlay — saving → analyzed → immediate feedback ── */}
      {busy && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/65 backdrop-blur-[3px]" dir="rtl">
          <div key={stage} className="onyx-pop-in w-full max-w-sm px-6 py-8">

            {stage === 'saving' && (
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="w-9 h-9 rounded-full border-2 border-[#d4af37]/15 border-t-[#d4af37] animate-spin" />
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/35">שומר את העסקה...</p>
              </div>
            )}

            {stage === 'analyzing' && (
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="w-9 h-9 rounded-full flex items-center justify-center border-2 border-[#22c55e]/30 bg-[#22c55e]/5">
                  <span className="text-[#22c55e] text-base leading-none">✓</span>
                </div>
                <p className="text-sm text-white/70">העסקה נשמרה</p>
                <div className="flex items-center gap-2">
                  <TypingDots />
                  <span className="font-mono text-[11px] text-white/35">Onyx מנתח את העסקה...</span>
                </div>
              </div>
            )}

            {stage === 'summary' && (
              <div className="space-y-5">
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center border-2 border-[#22c55e]/40 bg-[#22c55e]/5">
                    <span className="text-[#22c55e] text-lg leading-none">✓</span>
                  </div>
                  <p className="text-sm font-medium text-white/80">העסקה נשמרה בהצלחה</p>
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
                    הוסף עוד עסקה
                  </button>
                  <button
                    type="button"
                    onClick={finish}
                    className="flex-1 py-2.5 rounded-xl bg-[#d4af37] text-black font-mono text-[11px] font-bold uppercase tracking-[0.12em] hover:bg-[#e5c84a] transition-all duration-150"
                  >
                    סיימתי
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
