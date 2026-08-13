'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { TradeEntry, Direction, TradeResult, EmotionalState } from '../lib/journal';
import { analyzeStopMoves, type ManagementEvent } from '../lib/trade/management';
import { todayISO, computeStats, UNSPECIFIED_MODEL } from '../lib/journal';
import { calcRR, calcMultiExitPnL, calcMultiExitRealizedR, calcWeightedExitPrice, inferResult } from '../lib/calc/trade';
import { INSTRUMENT_KEYS, INSTRUMENTS, type InstrumentKey } from '../lib/instruments';
import { SESS, sessionForHour, getActiveSessionKey, type SessionKey } from '../lib/sessions';
import { analyzeInstruments, isoWeekKey, normSession } from '../lib/analytics';
import { confidenceLevelFor } from '../lib/analytics/confidence';
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

/** The default shape of the exit question: one leg, the whole position.
 *
 *  This used to be an empty array, and the section that rendered it was
 *  labelled "אופציונלי — למי שיצא בכמה חתיכות". 33 trades in, not one had an
 *  exit recorded — which is what a form gets when it tells the trader that
 *  skipping a field is free and that the result button will work it out.
 *
 *  It isn't free. Without a real exit price the R of the trade is the R the
 *  trade was PLANNED for, so a win is assumed to have banked its full target
 *  and a loss to have given back its whole stop. Every deviation from the plan
 *  — the thing the behaviour layer exists to find — is invisible by
 *  construction. The multi-leg case is still there, one click away; it is just
 *  no longer the only reason to answer. */
function singleLeg(contracts: string): ExitRow[] {
  return [{ price: '', contracts }];
}

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
  followedRules: '' | 'yes' | 'no';
  stopMoved: '' | 'none' | 'advanced' | 'widened';
  management: ManagementEvent[];
  confirmations: string[];
  emotionalState: EmotionalState | '';
  model: string;
  notes: string;
  screenshots: string[];
  /** Explicit trade result — set via the Stop / BE / Take buttons in the
      form. Empty string means "not chosen yet" (blocks save). */
  result: 'WIN' | 'LOSS' | 'BE' | '';
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
    exits: singleLeg('1'),
    followedRules: '',
    stopMoved: '',
    management: [],
    confirmations: [],
    emotionalState: '',
    model: '',
    notes: '',
    screenshots: [],
    result: '',
  };
}

/** Convert a TradeEntry back into the form's local shape — used when the user
    clicks Edit on an existing trade card. All numeric fields become strings
    (the form's inputs are text-mode and parse on submit). */
function fromTrade(t: TradeEntry): FormState {
  return {
    symbol: t.symbol,
    contracts: String(t.contracts ?? 1),
    direction: t.direction,
    date: t.dateISO,
    time: t.time,
    entry: String(t.entry),
    stop: String(t.stop),
    target: String(t.target),
    // A trade logged before the exit price was asked for opens with the
    // question waiting, not with the section missing.
    exits: t.exits?.length
      ? t.exits.map(e => ({ price: String(e.price), contracts: String(e.contracts) }))
      : singleLeg(String(t.contracts ?? 1)),
    followedRules: t.followedRules === true ? 'yes' : t.followedRules === false ? 'no' : '',
    stopMoved: t.stopMoved ?? '',
    management: t.management ?? [],
    confirmations: t.confirmations ?? [],
    emotionalState: t.emotionalState ?? '',
    model: t.model && t.model !== UNSPECIFIED_MODEL ? t.model : '',
    notes: t.notes ?? '',
    screenshots: t.screenshots ?? [],
    // OPEN in the DB means "no explicit result chosen" — surface it as an
    // empty selection so the trader is forced to pick one to save.
    result: t.result === 'OPEN' ? '' : t.result,
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
      // A win rate never stands naked: always carry the sample it's built on,
      // and flag a small sample as an early sign — same honesty as the
      // dashboard's confidence badge, so we never sell an n=3 "67%" as fact.
      const basis = `מבוסס על ${decided.length} עסקאות מוכרעות`;
      const caveat = confidenceLevelFor(decided.length) === 'low' ? ' — עדיין מדגם קטן, סימן מוקדם בלבד' : '';
      return `זו העסקה ה-${sessionThisWeek.length} שלך השבוע בסשן ${label}. אחוז ההצלחה בסשן: ${winRate}% (${basis})${caveat}.`;
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
  } else {
    // Not a detection failure — the entry time genuinely falls between the
    // tracked session windows. Say so, so it never reads as a broken feature.
    facts.push(`זמן הכניסה (${trade.time}) נופל מחוץ לחלונות הסשן שאנחנו עוקבים אחריהם.`);
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
  initial,
}: {
  onSave: (trade: TradeEntry) => void;
  onCancel?: () => void;
  /** Called when the trader is done with the post-save summary and wants to leave the form. Falls back to onCancel. */
  onDone?: () => void;
  /** Existing trades, used only to compute immediate before/after feedback (e.g. win rate) after saving. */
  trades?: TradeEntry[];
  /** When set, the form is in edit mode: prefilled from this trade and, on
      save, keeps the same id so the row is updated in place instead of a
      duplicate being appended. */
  initial?: TradeEntry;
}) {
  const [form, setForm] = useState<FormState>(() => (initial ? fromTrade(initial) : empty()));
  const [playbookSetups, setPlaybookSetups] = useState<PlaybookSetup[]>([]);
  const [customConfirmations, setCustomConfirmations] = useState<string[]>([]);
  const [newConfirmation, setNewConfirmation] = useState('');
  const [stopMoveDraft, setStopMoveDraft] = useState('');
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

  /** Position size, with the single exit leg kept in step with it.
   *
   *  While there is only one leg it means "I closed the whole thing here", so
   *  its size is not something the trader should have to restate — and a stale
   *  copy of an earlier size would silently mis-weight the realized R. Once
   *  the position is split across legs the sizes are real answers and are left
   *  alone. */
  function setContracts(value: string) {
    setForm(prev => ({
      ...prev,
      contracts: value,
      exits: prev.exits.length === 1
        ? [{ ...prev.exits[0], contracts: value }]
        : prev.exits,
    }));
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

  /** Split the position into another leg.
   *
   *  Going from one leg to two is the case worth handling carefully: the
   *  single leg holds the entire position, so appending "the remainder" would
   *  append zero — and falling back to the full size (which is what this did)
   *  would claim more contracts were closed than were ever opened. Splitting
   *  the size explicitly keeps the legs adding up to the position at every
   *  step. */
  function addExit() {
    setForm(prev => {
      if (prev.exits.length === 1) {
        const total = Math.max(1, parseInt(prev.contracts, 10) || 1);
        const first = Math.max(1, Math.ceil(total / 2));
        const rest  = total - first;
        return {
          ...prev,
          exits: [
            { ...prev.exits[0], contracts: String(first) },
            // A one-contract position has nothing to split. Leave the size
            // blank rather than inventing a second contract — an empty leg is
            // dropped on save, an invented one would overstate the realized R.
            { price: '', contracts: rest > 0 ? String(rest) : '' },
          ],
        };
      }
      return { ...prev, exits: [...prev.exits, { price: '', contracts: String(remainingContracts || 1) }] };
    });
  }
  function removeExit(i: number) {
    setForm(prev => {
      const next = prev.exits.filter((_, idx) => idx !== i);
      // Back to one leg — it means the whole position again, so re-sync it
      // rather than leaving it holding a half-size from the split.
      if (next.length === 1) return { ...prev, exits: [{ ...next[0], contracts: prev.contracts }] };
      // Never leave the trader with no way to answer the question.
      if (next.length === 0) return { ...prev, exits: singleLeg(prev.contracts) };
      return { ...prev, exits: next };
    });
  }
  function setExit(i: number, field: keyof ExitRow, value: string) {
    setForm(prev => ({ ...prev, exits: prev.exits.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)) }));
  }
  /** Log a stop move at the moment it happens.
   *
   *  Stamped with the clock rather than with a field the trader fills in: the
   *  entire value of an event over the answer at the end is that it was
   *  recorded while it was true, and a hand-typed time gives that away for
   *  nothing. */
  function logStopMove(price: string) {
    const to = parseFloat(price);
    if (!Number.isFinite(to)) return;
    setForm(prev => ({
      ...prev,
      management: [...prev.management, { at: new Date().toISOString(), kind: 'stop', to }],
      // The plan's stop stays as it was — it is the plan. The new level lives
      // in the event, which is what makes the difference measurable.
    }));
    setStopMoveDraft('');
  }
  function removeManagement(i: number) {
    setForm(prev => ({ ...prev, management: prev.management.filter((_, idx) => idx !== i) }));
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
  // What the logged moves add up to. Computed from the record, so the trader
  // sees the same number the detector will.
  const stopRecord = analyzeStopMoves(
    parseFloat(form.stop) || 0,
    form.direction,
    form.management,
  );

  const entryHour: number | null = parseHour(form.time);
  const autoSession: SessionKey | null = entryHour !== null ? sessionForHour(entryHour) : getActiveSessionKey();
  const declaredBias = getTodaysDeclaredBias();
  const alignment = computeBiasAlignment(declaredBias, form.direction);

  /** Builds the trade record and runs the save animation flow. Called either
      directly (no warnings) or after the trader dismisses the guardian panel. */
  /** `asOpen` saves the plan while the position is still running.
   *
   *  Same form, same fields — the only difference is that the result is left
   *  as OPEN and the record is written before the outcome exists. That timing
   *  is the whole point: levels saved while a trade is live cannot have been
   *  bent to match how it ended, because how it ended had not happened yet.
   *
   *  Deliberately NOT required, and a trade logged in one go afterwards is not
   *  marked, excluded or nagged about. The moment a missing plan costs the
   *  trader something, the cheapest way to get it back is to fill the plan in
   *  after the fact — and a fabricated plan the system believes is worse than
   *  no plan at all, because it turns "we don't know" into a confident wrong
   *  answer. */
  function performSave(asOpen = false) {
    const trade: TradeEntry = {
      // Preserve the id when editing so the save is an in-place update, not a
      // duplicate row.
      id: initial?.id ?? Date.now(),
      dateISO: form.date,
      time: form.time,
      symbol: form.symbol,
      contracts,
      direction: form.direction,
      entry,
      stop,
      target,
      // Explicit result from the Stop/BE/Take buttons wins; the exits-derived
      // result stays as a fallback for legacy edits that still use partial exits.
      result: asOpen ? 'OPEN' : (form.result || derivedResult),
      session: autoSession ?? 'NONE',
      bias: declaredBias ?? 'INDECISIVE',
      model: form.model || UNSPECIFIED_MODEL,
      notes: form.notes,
      screenshots: form.screenshots.length ? form.screenshots : undefined,
      exits: hasExits ? parsedExits : undefined,
      confirmations: form.confirmations.length ? form.confirmations : undefined,
      emotionalState: form.emotionalState || undefined,
      followedRules: form.followedRules === 'yes' ? true : form.followedRules === 'no' ? false : undefined,
      stopMoved: form.stopMoved || undefined,
      management: form.management.length ? form.management : undefined,
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
    // Explicit result is now required — "no more open trades". If neither the
    // user picked a result nor the exits imply one, refuse to save.
    if (!form.result && derivedResult === 'OPEN') return;

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

  /** Save the plan and leave the trade running. Skips the result requirement
   *  and the guardian — the guardian warns about entering, and by the time
   *  this button is pressed the trader is already in. */
  function saveAsOpen() {
    if (!form.entry || !form.stop || !form.target || stage !== 'idle') return;
    performSave(true);
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
              <input type="number" min={1} step="1" value={form.contracts} onChange={e => setContracts(e.target.value)} placeholder="1" className={inputCls} required />
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

        {/* ── EXIT — where the trade ACTUALLY closed.
             See singleLeg() for why this stopped being an optional section for
             partial-exit traders and became a question every trade is asked.

             Deliberately NOT prefilled from the result button. Prefilling the
             target on a win would put a measured-looking number in a field
             nobody checked, and "exit == target, exactly" is precisely the
             reading the early-exit detector is built to trust. An empty field
             the trader fills in is worth more than a populated one they
             skimmed past. ── */}
        <Group label="איפה יצאת בפועל?">
          <div className="space-y-2">
            {form.exits.map((exitRow, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number" step="0.25"
                  placeholder={form.exits.length === 1 ? 'מחיר היציאה שלך' : `מחיר יציאה ${i + 1}`}
                  value={exitRow.price} onChange={e => setExit(i, 'price', e.target.value)}
                  className={inputCls}
                />
                {/* One leg means the whole position, so its size is not a
                    question. It becomes one only once the position is split. */}
                {form.exits.length > 1 && (
                  <>
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
                  </>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addExit}
            className="font-mono text-xs text-[#d4af37]/70 hover:text-[#d4af37] transition-colors duration-150"
          >
            {form.exits.length === 1 ? '➕ יצאתי בכמה חלקים' : '➕ הוסף יציאה נוספת'}
          </button>

          {!hasExits && (
            <p className="font-mono text-[11px] text-white/40 leading-relaxed">
              בלי מחיר יציאה, ה-R של העסקה יחושב לפי התוכנית — כאילו טייק נלקח
              במלואו וסטופ ננגס במלואו. זה כמעט אף פעם לא מה שקרה, והפער בין
              השניים הוא בדיוק מה שהמערכת מחפשת.
            </p>
          )}

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

        {/* ── RESULT — required. Stop = LOSS, ברייק איוון = BE, טייק = WIN.
             Selecting one overrides any exits-derived result on save.

             Sits AFTER the exit price now, and the order is the point: the
             trader states where they got out, and only then labels it. Asking
             for the label first invites the exit to be reconstructed to match
             it — "it was a win, so I suppose I took the target" — which is the
             same fiction we removed from the code, re-entered by hand. */}
        <Group label="תוצאת העסקה *">
          <div className="flex items-center gap-2">
            <FormResultBtn
              label="סטופ" glyph="▼" active={form.result === 'LOSS'}
              activeColor="#ef4444" activeBg="rgba(239,68,68,0.14)" activeBd="rgba(239,68,68,0.5)"
              onClick={() => set('result', form.result === 'LOSS' ? '' : 'LOSS')}
            />
            <FormResultBtn
              label="ברייק איוון" glyph="◆" active={form.result === 'BE'}
              activeColor="#d4af37" activeBg="rgba(212,175,55,0.12)" activeBd="rgba(212,175,55,0.45)"
              onClick={() => set('result', form.result === 'BE' ? '' : 'BE')}
            />
            <FormResultBtn
              label="טייק" glyph="▲" active={form.result === 'WIN'}
              activeColor="#22c55e" activeBg="rgba(34,197,94,0.14)" activeBd="rgba(34,197,94,0.5)"
              onClick={() => set('result', form.result === 'WIN' ? '' : 'WIN')}
            />
          </div>
          {!form.result && (
            <p className="font-mono text-[11px] text-white/40 leading-relaxed mt-2">
              חייב לבחור תוצאה — סטופ / BE / טייק. אחרת לא ניתן לשמור.
            </p>
          )}

          {/* The label and the exit price disagreeing is almost always a typo
              — a price entered in points, a digit dropped, the wrong button.
              It is worth catching here because the two are used for different
              things downstream: the label drives the statistics the trader
              reads, and the exit drives the behaviour analysis. Silently
              storing a contradiction puts one number in each and leaves them
              to disagree forever, in two places nobody compares.

              Shown, not blocked: a trade CAN legitimately be labelled BE and
              have closed a tick away. The trader is the authority — they just
              need to see it. */}
          {form.result && hasExits && derivedResult !== form.result && (
            <p className="font-mono text-[11px] leading-relaxed mt-2 text-[#d4af37]">
              סימנת {RESULT_HE[form.result]}, אבל מחיר היציאה שרשמת אומר {RESULT_HE[derivedResult]}
              {realizedR !== null && ` (${realizedR.toFixed(2)}R)`}. בדוק שהמחירים נכונים — כניסה, סטופ, יעד ויציאה צריכים להיות מחירים מלאים, לא נקודות.
            </p>
          )}
        </Group>

        {/* ── RULE ADHERENCE — the trader's own verdict on their own trade.
             The most trustworthy signal in the journal, because it is
             judgement rather than something we inferred from prices.

             Deliberately unanswered by default, and deliberately not a
             checkbox: a checkbox has an implicit "no" and this question has
             three answers. Silence must stay distinguishable from "yes",
             otherwise every rule-adherence number becomes a flattering
             fiction built from the trades nobody bothered to grade. ── */}
        <Group label="עמדתי בחוקים שלי? (אופציונלי)">
          <div className="flex items-center gap-2">
            <FormResultBtn
              label="עמדתי" glyph="✓" active={form.followedRules === 'yes'}
              activeColor="#22c55e" activeBg="rgba(34,197,94,0.14)" activeBd="rgba(34,197,94,0.5)"
              onClick={() => set('followedRules', form.followedRules === 'yes' ? '' : 'yes')}
            />
            <FormResultBtn
              label="סטיתי" glyph="✕" active={form.followedRules === 'no'}
              activeColor="#ef4444" activeBg="rgba(239,68,68,0.14)" activeBd="rgba(239,68,68,0.5)"
              onClick={() => set('followedRules', form.followedRules === 'no' ? '' : 'no')}
            />
          </div>
          <p className="font-mono text-[11px] text-white/40 leading-relaxed mt-2">
            {form.followedRules === ''
              ? 'אם תדלג — העסקה לא תיספר לשני הכיוונים. עדיף לא לענות מאשר לענות לא נכון.'
              : 'התשובה שלך על העסקה הזו — לא נגזרת מהתוצאה.'}
          </p>
        </Group>

        {/* ── STOP MANAGEMENT — the one management decision the tables cannot
             reconstruct. Three answers, not two: advancing a stop to protect a
             position and widening it to avoid being stopped out are opposite
             acts, and a yes/no would count them as the same thing and measure
             nothing. Unanswered stays unanswered. ── */}
        <Group label="מה קרה לסטופ אחרי הכניסה? (אופציונלי)">
          <div className="flex items-center gap-2">
            <FormResultBtn
              label="לא נגעתי" glyph="=" active={form.stopMoved === 'none'}
              activeColor="#22c55e" activeBg="rgba(34,197,94,0.14)" activeBd="rgba(34,197,94,0.5)"
              onClick={() => set('stopMoved', form.stopMoved === 'none' ? '' : 'none')}
            />
            <FormResultBtn
              label="קידמתי" glyph="▲" active={form.stopMoved === 'advanced'}
              activeColor="#d4af37" activeBg="rgba(212,175,55,0.12)" activeBd="rgba(212,175,55,0.45)"
              onClick={() => set('stopMoved', form.stopMoved === 'advanced' ? '' : 'advanced')}
            />
            <FormResultBtn
              label="הרחקתי" glyph="▼" active={form.stopMoved === 'widened'}
              activeColor="#ef4444" activeBg="rgba(239,68,68,0.14)" activeBd="rgba(239,68,68,0.5)"
              onClick={() => set('stopMoved', form.stopMoved === 'widened' ? '' : 'widened')}
            />
          </div>
          <p className="font-mono text-[11px] text-white/40 leading-relaxed mt-2">
            {form.stopMoved === ''
              ? 'קידום הוא משמעת, הרחקה היא סיכון — לכן זו לא שאלת כן/לא. אם תדלג, העסקה לא תיספר לשום כיוון.'
              : 'זו התשובה מהזיכרון. אם תרשום את ההזזה בזמן אמת למטה, המערכת תחשב את הכיוון בעצמה.'}
          </p>

          {/* The log. Every entry is stamped with the clock rather than with a
              field the trader fills in — the entire value of an event over an
              answer at the end is that it was recorded while it was true, and
              a hand-typed time gives that away for nothing.

              When events exist they OVERRIDE the buttons above: a record beats
              a recollection, and the readout says which one is in force so the
              trader can see it too. */}
          <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="number" step="0.25"
                placeholder="הזזתי את הסטופ ל…"
                value={stopMoveDraft}
                onChange={e => setStopMoveDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); logStopMove(stopMoveDraft); } }}
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => logStopMove(stopMoveDraft)}
                disabled={!stopMoveDraft.trim()}
                className="shrink-0 px-4 py-2.5 rounded-lg border border-[#d4af37]/35 text-[#d4af37] font-mono text-xs hover:bg-[#d4af37]/10 transition-colors duration-150 disabled:text-white/20 disabled:border-white/[0.06] disabled:cursor-not-allowed"
              >
                רשום
              </button>
            </div>

            {form.management.length > 0 && (
              <div className="space-y-1.5">
                {form.management.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 font-mono text-[11px] text-white/50">
                    <span className="text-white/30" dir="ltr">
                      {new Date(m.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span>סטופ → {m.to}</span>
                    <button
                      type="button" onClick={() => removeManagement(i)} aria-label="מחק רישום"
                      className="text-white/20 hover:text-[#ef4444] transition-colors duration-150"
                    >✕</button>
                  </div>
                ))}
                {stopRecord.moves > 0 && (
                  <p className="font-mono text-[11px] text-[#d4af37]/80 leading-relaxed pt-1">
                    מהרישום: {stopRecord.advanced > 0 && `${stopRecord.advanced} קידום`}
                    {stopRecord.advanced > 0 && stopRecord.widened > 0 && ' · '}
                    {stopRecord.widened > 0 && `${stopRecord.widened} הרחקה`}
                    {stopRecord.widened === 0 && stopRecord.advanced === 0 && 'ללא שינוי בפועל'}
                    {' — '}זה מה שייספר, לא הכפתורים למעלה.
                  </p>
                )}
              </div>
            )}
          </div>
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
            disabled={!form.result && derivedResult === 'OPEN'}
            className="flex-1 py-3.5 rounded-xl font-mono text-sm font-bold uppercase tracking-[0.14em] transition-all duration-200 bg-[#d4af37] text-black hover:bg-[#e5c84a] hover:scale-[1.01] [box-shadow:0_0_24px_rgba(212,175,55,0.25)] disabled:bg-[#3a3527] disabled:text-white/30 disabled:cursor-not-allowed disabled:[box-shadow:none] disabled:hover:scale-100"
          >
            {initial ? 'שמור שינויים' : 'שמור עסקה'}
          </button>
          {/* Save the plan while the position is still running.
              Hidden when editing — a trade already in the journal is reopened
              to be finished, not to be re-planned. */}
          {!initial && (
            <button
              type="button"
              onClick={saveAsOpen}
              disabled={!form.entry || !form.stop || !form.target}
              title="שומר את הרמות עכשיו. תשלים מחיר יציאה כשתסגור."
              className="px-5 py-3.5 rounded-xl border border-[#d4af37]/35 text-[#d4af37] font-mono text-sm uppercase tracking-[0.14em] hover:bg-[#d4af37]/10 transition-colors duration-150 disabled:text-white/20 disabled:border-white/[0.06] disabled:cursor-not-allowed"
            >
              שמור פתוחה
            </button>
          )}
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
                onClick={() => performSave()}
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

/** Result picker button — Stop / BE / Take. Highlighted when selected; click
    again to deselect. Colors match the rest of the app's result palette. */
function FormResultBtn({
  label, glyph, active, activeColor, activeBg, activeBd, onClick,
}: {
  label: string; glyph: string;
  active: boolean; activeColor: string; activeBg: string; activeBd: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-[8px] border text-[13px] font-bold transition-all duration-200"
      style={{
        borderColor: active ? activeBd : 'rgba(28,28,30,1)',
        background: active ? activeBg : 'rgba(255,255,255,0.02)',
        color: active ? activeColor : 'rgba(255,255,255,0.55)',
      }}
    >
      <span className="text-[11px]">{glyph}</span>{label}
    </button>
  );
}
