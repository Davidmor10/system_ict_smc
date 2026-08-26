'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { TradeEntry, Direction, TradeResult, EmotionalState, Bias } from '../lib/journal';
import { todayISO, computeStats, UNSPECIFIED_MODEL } from '../lib/journal';
import { calcRR, calcMultiExitPnL, calcMultiExitRealizedR, calcWeightedExitPrice, inferResult } from '../lib/calc/trade';
import { decidedCounts, winRatePercent } from '../lib/calc/decided';
import { INSTRUMENT_KEYS, INSTRUMENTS, type InstrumentKey } from '../lib/instruments';
import { commitList, hydrateList } from '../lib/sync/collections';
import {
  DEFAULT_CONFIRMATIONS, labelForConfirmation, chipList, addTag, removeTag,
  loadConfirmations, saveConfirmations, type CustomConfirmation,
} from '../lib/confirmationTags';
import { ruleTitle, type Rule } from '../lib/rules/types';
import { sessionForHour, getActiveSessionKey, sessionLabel, type SessionKey } from '../lib/sessions';
import { clockInZone } from '../lib/time/zone';
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


const EMOTIONAL_STATE_OPTIONS: { key: EmotionalState; label: string }[] = [
  { key: 'CALM', label: 'רגוע' },
  { key: 'CONFIDENT', label: 'בטוח' },
  { key: 'STRESSED', label: 'לחוץ' },
  { key: 'FOMO', label: 'FOMO' },
  { key: 'TIRED', label: 'עייף' },
  { key: 'ANGRY', label: 'כועס' },
  { key: 'IMPATIENT', label: 'חסר סבלנות' },
];

interface PlaybookSetup { id: string; name: string; deleted?: boolean; status?: string; pinned?: boolean }

function loadPlaybookSetups(): PlaybookSetup[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PLAYBOOK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // The playbook store keeps soft-delete tombstones for cross-device sync —
    // never offer a deleted setup in the picker.
    //
    // Paused setups are also withheld. A trader who parks a setup has said it
    // is not in play; offering it here is how a paused setup keeps collecting
    // trades and never looks paused in the numbers. `testing` stays on the
    // list — that status exists precisely to gather a sample.
    const live = parsed.filter((s): s is PlaybookSetup =>
      !!s?.name && !s?.deleted && s?.status !== 'paused');
    // Pinned first, matching the order the setups page shows them in.
    return [...live.filter(s => s.pinned), ...live.filter(s => !s.pinned)];
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
// ─────────────────────────────────────────────────────────────────────────────
// Smart defaults.
//
// A trader who trades ES off the same setup with the same confirmations most
// days was re-picking all three on every trade. What they chose last time is
// the best guess available, it is one tap to change, and it is stored per
// device rather than synced — this is a keyboard shortcut, not a preference.
// ─────────────────────────────────────────────────────────────────────────────

const LAST_USED_KEY = 'onyx_trade_last_used';

interface LastUsed { symbol: InstrumentKey; model: string; confirmations: string[] }

function loadLastUsed(): LastUsed {
  const fallback: LastUsed = { symbol: 'ES', model: '', confirmations: [] };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(LAST_USED_KEY);
    if (!raw) return fallback;
    const o = JSON.parse(raw) as Partial<LastUsed>;
    return {
      symbol: INSTRUMENT_KEYS.includes(o.symbol as InstrumentKey) ? (o.symbol as InstrumentKey) : fallback.symbol,
      model: typeof o.model === 'string' ? o.model : '',
      confirmations: Array.isArray(o.confirmations)
        ? o.confirmations.filter((c): c is string => typeof c === 'string').slice(0, 12)
        : [],
    };
  } catch {
    return fallback;
  }
}

function saveLastUsed(v: LastUsed): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LAST_USED_KEY, JSON.stringify(v)); } catch { /* quota — non-fatal */ }
}

/** The quick tags on the "advanced the stop" branch. */

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
  /** The direction the trader had for the day. Asked here rather than read
      from a dashboard plan they may never have saved. */
  dayBias: Bias | '';
  stopMoved: '' | 'none' | 'advanced' | 'widened';
  stopNote: string;
  /** Ids of the trader's own rules they broke on this trade. Only meaningful
   *  when followedRules === 'no'. Saved as violation records, not on the
   *  trade — the rules page already owns that model. */
  brokenRules: string[];
  confirmations: string[];
  emotionalState: EmotionalState | '';
  model: string;
  notes: string;
  screenshots: string[];
}

function empty(): FormState {
  // A trader who trades the same instrument off the same setup most days
  // should not re-pick both every time. What they chose last is the best
  // available guess, and it is one tap to change.
  const last = loadLastUsed();
  return {
    symbol: last.symbol,
    contracts: '1',
    direction: 'LONG',
    date: todayISO(),
    // The clock in settings, not the browser's. A trader in one place trading
    // another market's hours would otherwise get an entry time that disagrees
    // with the session the same form is about to stamp on it.
    time: clockInZone(),
    entry: '',
    stop: '',
    target: '',
    exits: singleLeg('1'),
    followedRules: '',
    dayBias: getTodaysDeclaredBias() ?? '',
    stopMoved: '',
    stopNote: '',
    brokenRules: [],
    confirmations: last.confirmations,
    emotionalState: '',
    model: last.model,
    notes: '',
    screenshots: [],
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
    dayBias: t.bias ?? '',
    stopMoved: t.stopMoved ?? '',
    stopNote: t.stopNote ?? '',
    brokenRules: [],
    confirmations: t.confirmations ?? [],
    emotionalState: t.emotionalState ?? '',
    model: t.model && t.model !== UNSPECIFIED_MODEL ? t.model : '',
    notes: t.notes ?? '',
    screenshots: t.screenshots ?? [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Broken rules → the violations the rules page already owns.
//
// Written as violation records rather than as a field on the trade, because
// the rules page, the compliance streak and the discipline stats all read that
// collection already. A second home for the same fact would mean two numbers
// that drift.
//
// Ids are deterministic — `v_<tradeId>_<ruleId>` — so re-saving an edited
// trade REPLACES its violations instead of appending a duplicate set, and
// un-ticking a rule tombstones the row the same way the rules page does.
// ─────────────────────────────────────────────────────────────────────────────

interface RuleViolationRow {
  id: string; ruleId: string; date: string; tradeNote?: string;
  updatedAt?: number; deleted?: boolean;
}

const VIOLATIONS_KEY = 'onyx_rule_violations';

async function recordBrokenRules(tradeId: number, dateISO: string, ruleIds: string[]): Promise<void> {
  const mine = (v: RuleViolationRow) => v.id.startsWith(`v_${tradeId}_`);
  try {
    const existing = await hydrateList<RuleViolationRow>('violations', VIOLATIONS_KEY);
    // Nothing to do, and nothing to clean up.
    if (ruleIds.length === 0 && !existing.some(mine)) return;

    const now = Date.now();
    const keep = existing.filter(v => !mine(v));
    const fresh: RuleViolationRow[] = ruleIds.map(ruleId => ({
      id: `v_${tradeId}_${ruleId}`,
      ruleId,
      date: dateISO,
      tradeNote: 'סומן בטופס העסקה',
      updatedAt: now,
    }));
    // Tombstone whatever this trade used to claim and no longer does, so the
    // removal reaches the other devices instead of the row coming back.
    const removed: RuleViolationRow[] = existing
      .filter(v => mine(v) && !ruleIds.includes(v.ruleId))
      .map(v => ({ ...v, deleted: true, updatedAt: now }));

    await commitList<RuleViolationRow>('violations', VIOLATIONS_KEY, [...keep, ...fresh, ...removed]);
  } catch { /* the trade itself is saved; a failed violation write must not undo it */ }
}

/** One line straight from the analytics engine — no network call, so it's on screen
    instantly. Only fires once the trader has 3+ trades logged (any dates), matching
    the same threshold every AI surface in the app uses. */
function buildInstantInsight(trade: TradeEntry, allTrades: TradeEntry[]): string | null {
  if (allTrades.length < 3) return null;

  if (trade.session && trade.session !== 'NONE') {
    const week = isoWeekKey(trade.dateISO);
    const sessionThisWeek = allTrades.filter(t => normSession(t.session) === normSession(trade.session) && isoWeekKey(t.dateISO) === week);
    const { decided } = decidedCounts(sessionThisWeek);
    if (decided > 0) {
      const winRate = Math.round(winRatePercent(sessionThisWeek)!);
      const label = sessionLabel(trade.session);
      // A win rate never stands naked: always carry the sample it's built on,
      // and flag a small sample as an early sign — same honesty as the
      // dashboard's confidence badge, so we never sell an n=3 "67%" as fact.
      const basis = `מבוסס על ${decided} עסקאות שנסגרו`;
      const caveat = confidenceLevelFor(decided) === 'low' ? ' — עדיין מדגם קטן, סימן מוקדם בלבד' : '';
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
    const label = sessionLabel(trade.session);
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

  // Only says something when there IS a declared direction. Saying "aligned
  // with today's bias" under a trade taken on a day with no bias is how this
  // was appearing under a long and a short twenty minutes apart.
  if (trade.biasAlignment === 'ALIGNED')      facts.push('מיושרת עם הכיוון שהגדרת להיום.');
  else if (trade.biasAlignment === 'COUNTER') facts.push('נגד הכיוון שהגדרת להיום — לשים לב.');

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

/** `needed` marks a question a closed trade cannot be saved without.
 *
 *  Shown while it is still unanswered and cleared the moment it is, so the
 *  form reads as a short list of what is left rather than a wall of asterisks
 *  the eye stops seeing. */
function Field({ label, children, needed }: {
  label: string; children: React.ReactNode; needed?: boolean;
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-white/35 mb-1.5">
        {label}
        {needed && <span className="text-[#d4af37]/70 mr-1.5 tracking-normal">· חובה</span>}
      </label>
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
  presetModel,
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
  /** Preselect this playbook setup on a NEW trade — the "שימוש בסטאפ" path
      from the setups page. Deliberately not folded into `initial`: that prop
      means "edit this existing trade", and passing a synthetic trade to carry
      one field would make the form save an update to a row that never
      existed. Ignored when `initial` is set, because an edit already has its
      own model and the trader's own choice outranks a link. */
  presetModel?: string;
}) {
  const [form, setForm] = useState<FormState>(
    () => (initial ? fromTrade(initial) : { ...empty(), model: presetModel ?? '' }),
  );
  const [playbookSetups, setPlaybookSetups] = useState<PlaybookSetup[]>([]);
  const [customConfirmations, setCustomConfirmations] = useState<CustomConfirmation[]>([]);
  const [newConfirmation, setNewConfirmation] = useState('');
  /** The trader's own active rules — the list shown when they say they broke one. */
  const [activeRules, setActiveRules] = useState<Rule[]>([]);
  /** Group 5 is folded by default: a trader in a hurry never opens it. */
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [stage, setStage] = useState<SaveStage>('idle');
  const [summaryFacts, setSummaryFacts] = useState<string[]>([]);
  const [guardWarnings, setGuardWarnings] = useState<GuardianWarning[]>([]);

  useEffect(() => {
    setPlaybookSetups(loadPlaybookSetups());
    // The catalogue is a cloud collection now, so this is a round-trip rather
    // than a localStorage read. It resolves after the first paint; the chips
    // are additive, so a tag appearing a beat late is invisible in practice.
    void loadConfirmations().then(setCustomConfirmations).catch(() => {});
    hydrateList<Rule>('rules', 'onyx_trading_rules')
      .then(rs => setActiveRules(rs.filter(r => r.isActive && !r.deleted)))
      .catch(() => { /* no rules yet, or offline — the question just has no list */ });
  }, []);

  // Defaults first, then whatever the trader has added — de-duplicated so a
  // custom tag can never shadow a built-in one.
  const availableConfirmations = chipList(customConfirmations);

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
    const updated = addTag(customConfirmations, tag);
    // addTag returns null when the tag is already in the catalogue. The
    // case-insensitive check above normally catches that first; this covers the
    // race where another device added the same tag between hydrate and now.
    if (!updated) {
      setForm(prev => ({ ...prev, confirmations: prev.confirmations.includes(tag) ? prev.confirmations : [...prev.confirmations, tag] }));
      return;
    }
    setCustomConfirmations(updated);
    void saveConfirmations(updated);
    setForm(prev => ({ ...prev, confirmations: [...prev.confirmations, tag] }));
  }
  function removeCustomConfirmation(tag: string) {
    const updated = removeTag(customConfirmations, tag);
    setCustomConfirmations(updated);
    // Tombstoned rather than dropped, so the delete reaches the other device
    // instead of the tag reappearing on the next merge.
    void saveConfirmations(updated);
    // Deselecting it here only affects the trade being written. Tags already
    // recorded on past trades are untouched — the catalogue is the vocabulary,
    // not the history, and removing a word does not unsay it.
    setForm(prev => ({ ...prev, confirmations: prev.confirmations.filter(c => c !== tag) }));
  }
  function selectModel(name: string) {
    setForm(prev => ({ ...prev, model: prev.model === name ? '' : name }));
  }
  function toggleBrokenRule(id: string) {
    setForm(prev => ({
      ...prev,
      brokenRules: prev.brokenRules.includes(id)
        ? prev.brokenRules.filter(r => r !== id)
        : [...prev.brokenRules, id],
    }));
  }
  /** Answering "I kept them" clears any rules that were ticked first — the two
   *  answers cannot both be true, and leaving stale ticks behind would write
   *  violations for a trade the trader just said was clean. */
  function setFollowedRules(value: 'yes' | 'no' | '') {
    setForm(prev => ({
      ...prev,
      followedRules: value,
      brokenRules: value === 'no' ? prev.brokenRules : [],
    }));
  }
  function setEmotionalState(state: EmotionalState) {
    setForm(prev => ({ ...prev, emotionalState: prev.emotionalState === state ? '' : state }));
  }

  const entryHour: number | null = parseHour(form.time);
  const autoSession: SessionKey | null = entryHour !== null ? sessionForHour(entryHour) : getActiveSessionKey();
  // From the field on this form, not from a plan somewhere else. `null` means
  // "no directional view declared", which is a real state and not alignment.
  const alignment = computeBiasAlignment(form.dayBias || null, form.direction);

  /** Builds the trade record and runs the save animation flow. Called either
      directly (no warnings) or after the trader dismisses the guardian panel. */
  /** A trade is logged once, after it closed.
   *
   *  There used to be a second path here — "save as open", which wrote the
   *  levels while the position was still running. The reasoning was that a
   *  plan recorded mid-trade cannot have been bent to match how the trade
   *  ended. What it produced in practice was half-written rows: a record with
   *  no outcome, no stop answer and no rule verdict, which every analysis then
   *  had to skip. A journal of trades nobody finished writing is not a
   *  journal.
   *
   *  OPEN survives as a RESULT, because trades saved that way are still in
   *  people's journals and must stay editable and closable. Nothing new
   *  arrives in that state. */
  function performSave() {
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
      // Derived from where the trade actually closed — never asked for.
      //
      // The label used to be three buttons the trader pressed, and pressing it
      // BEFORE typing an exit invited the exit to be reconstructed to match:
      // "it was a win, so I suppose I took the target". Now the exit price is
      // the only input and the label follows from it, so the two can never
      // disagree. An edit of a pre-exits trade keeps the result it was saved
      // with rather than being reset to OPEN.
      result: derivedResult !== 'OPEN' ? derivedResult : (initial?.result ?? 'OPEN'),
      session: autoSession ?? 'NONE',
      bias: form.dayBias || 'INDECISIVE',
      model: form.model || UNSPECIFIED_MODEL,
      notes: form.notes,
      screenshots: form.screenshots.length ? form.screenshots : undefined,
      exits: hasExits ? parsedExits : undefined,
      confirmations: form.confirmations.length ? form.confirmations : undefined,
      emotionalState: form.emotionalState || undefined,
      followedRules: form.followedRules === 'yes' ? true : form.followedRules === 'no' ? false : undefined,
      stopMoved: form.stopMoved || undefined,
      // The tag only means anything on the branch it belongs to.
      stopNote: form.stopNote.trim() || undefined,
      tradeR: realizedR ?? undefined,
      pnlUsd: realizedPnl ?? undefined,
      biasAlignment: alignment ?? undefined,
    };

    const priorTrades = trades;
    setGuardWarnings([]);

    saveLastUsed({ symbol: form.symbol, model: form.model, confirmations: form.confirmations });
    void recordBrokenRules(trade.id, trade.dateISO, form.followedRules === 'no' ? form.brokenRules : []);

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

  /** The three answers only the trader can give.
   *
   *  Every price on this form is already required, so the numeric side of a
   *  trade is complete by construction. The human side was not, and that is
   *  the side the behaviour layer is built on — with a specific cost: an
   *  unanswered rule verdict or stop question does not make the trade look
   *  clean, it removes the trade from the measurement entirely. A journal half
   *  answered is a denominator half the size, and three behaviours sat at low
   *  confidence for exactly that reason.
   *
   *  Each has an answer that means "nothing happened" — "I kept my rules",
   *  "I didn't touch it". So this asks the trader to ANSWER, never to report
   *  something. That distinction is what keeps it from shaping the data.
   *
   *  Confirmations are deliberately absent, and must stay absent. The
   *  `no_confirmation` detector measures the EMPTINESS of that field; require
   *  it and the detector can never fire again. A field whose blankness is the
   *  signal cannot be made mandatory. */
  const missingRequired = [
    derivedResult === 'OPEN'    ? 'מחיר יציאה'   : null,
    form.followedRules  === '' ? 'עמידה בחוקים'  : null,
    form.stopMoved      === '' ? 'הזזת סטופ'     : null,
    form.emotionalState === '' ? 'מצב רגשי'      : null,
  ].filter((x): x is string => x !== null);

  /** A new trade is complete or it is not saved.
   *
   *  An edit stays savable whatever is missing. Two reasons, and both matter:
   *  trades logged before any of this was required must remain editable — they
   *  are marked in the journal rather than held hostage — and a trade saved
   *  while OPEN under the old flow has to be reachable in order to be closed.
   *  Blocking the edit would strand exactly the rows that need finishing. */
  const canSubmit = initial != null || missingRequired.length === 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.entry || !form.stop || !form.target || stage !== 'idle') return;
    if (!canSubmit) return;

    // Discipline guardian — surface any evidence-backed concern before saving.
    // Never blocks: if warnings exist, show them and let the trader decide.
    const warnings = checkTrade(
      { symbol: form.symbol, direction: form.direction, session: autoSession, emotionalState: form.emotionalState || undefined, biasAlignment: alignment ?? undefined },
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

        {/* ═══════════════════════════════════════════════════════════════
            The order is the design. It follows the trader's memory, not the
            database's column order: what just happened is asked first while it
            is sharp, and the reasoning behind it — which is reconstructed
            either way — is asked last. A trader in a hurry answers groups 1, 2
            and 4 in about eight taps and sees their realised R at the end of
            group 2; a trader who wants depth opens group 5.

            Nothing here asks for a number the app can compute. Planned R:R,
            realised R, realised P&L and the trade's result are all shown, and
            none of them is an input.
            ═══════════════════════════════════════════════════════════════ */}

        {/* ── 1 · THE TRADE — asked first because it is the freshest ── */}
        <Group label="1 · העסקה">
          {/* When it happened, asked first. Both are prefilled with now, so a
              trade logged as it closes costs nothing — but a trade logged in
              the evening is retyped here rather than being silently stamped
              with the wrong hour. The session below is read from this time,
              which is why it sits next to it and not at the bottom of the
              form. */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="תאריך">
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={inputCls} required />
            </Field>
            <Field label="שעת כניסה">
              <input type="time" value={form.time} onChange={e => set('time', e.target.value)} className={inputCls} required />
            </Field>
          </div>
          <p className="font-mono text-[10px] text-white/30 -mt-2">
            מושב מזוהה אוטומטית: <b className="text-white/60">{autoSession ? sessionLabel(autoSession) : 'מחוץ לשעות מסחר'}</b>
          </p>

          <Field label="נכס">
            <div className="grid grid-cols-4 gap-1.5">
              {INSTRUMENT_KEYS.map(sym => (
                <button type="button" key={sym} onClick={() => set('symbol', sym)}
                  title={INSTRUMENTS[sym].label}
                  className={toggleBtn(form.symbol === sym, 'border-[#d4af37]/60 bg-[#d4af37]/10 text-[#d4af37]')}>
                  {sym}
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

          {/* Display only. It is the three fields above, divided. */}
          {rr !== null && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.02]">
              <span className="font-mono text-[9px] text-white/30 uppercase tracking-[0.18em]">R:R מתוכנן</span>
              <span className="font-mono text-lg font-bold" style={{ color: rrColor }}>{rr.toFixed(2)}R</span>
            </div>
          )}
        </Group>

        {/* ── 2 · EXIT & MANAGEMENT — same mental context, asked immediately ── */}
        <Group label="2 · יציאה וניהול">
          {/* Three answers, not two. Advancing a stop to protect a position and
              widening it to avoid being stopped out are opposite acts; a yes/no
              would count them as one thing and measure nothing. This replaces
              the separate "what happened to the stop" section, which asked the
              same question twice. */}
          <Field label="נגעת בסטופ אחרי הכניסה?" needed={!initial && form.stopMoved === ''}>
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
          </Field>

          {/* Where it actually closed. Deliberately never prefilled from
              anything: "exit == target, exactly" is precisely the reading the
              early-exit detector is built to trust, and a populated field
              nobody checked would hand it a fiction. */}
          <Field label="איפה יצאת בפועל?">
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
              className="font-mono text-xs text-[#d4af37]/70 hover:text-[#d4af37] transition-colors duration-150 mt-2"
            >
              {form.exits.length === 1 ? '➕ הוספת יציאה חלקית' : '➕ הוסף יציאה נוספת'}
            </button>
          </Field>

          {/* The immediate feedback that turns logging into a read. Realised R
              leads, because it is the number the rest of the app is built on. */}
          {hasExits ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3.5 rounded-xl border border-[#d4af37]/20 bg-[#d4af37]/[0.04] onyx-pop-in">
              <div>
                <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">R ממומש</span>
                <span
                  className="font-mono text-2xl font-bold leading-none"
                  style={{ color: (realizedR ?? 0) > 0 ? '#22c55e' : (realizedR ?? 0) < 0 ? '#ef4444' : '#d4af37' }}
                  dir="ltr"
                >
                  {realizedR !== null ? `${realizedR >= 0 ? '+' : ''}${realizedR.toFixed(2)}R` : '—'}
                </span>
              </div>
              <div className="h-9 w-px bg-white/[0.08]" />
              <div>
                <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">רווח/הפסד</span>
                <span className="font-mono text-base font-bold" style={{ color: (realizedPnl ?? 0) >= 0 ? '#22c55e' : '#ef4444' }} dir="ltr">
                  {realizedPnl !== null ? `${realizedPnl >= 0 ? '+' : ''}$${Math.abs(realizedPnl).toFixed(0)}` : '—'}
                </span>
              </div>
              <div className="h-9 w-px bg-white/[0.08]" />
              <div>
                <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">תוצאה</span>
                <span className="font-mono text-sm font-bold" style={{ color: resultColor }}>{RESULT_HE[derivedResult]}</span>
              </div>
              {remainingContracts > 0 && (
                <>
                  <div className="h-9 w-px bg-white/[0.08]" />
                  <div>
                    <span className="font-mono text-[9px] text-white/30 block uppercase tracking-[0.18em]">חוזים פתוחים</span>
                    <span className="font-mono text-sm font-bold text-white/60">{remainingContracts}</span>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="font-mono text-[11px] text-white/40 leading-relaxed">
              מחיר היציאה הוא מה שקובע את ה-R ואת התוצאה — שניהם מחושבים, לא נשאלים.
              עסקה מתועדת אחרי שהיא נסגרה, ולכן בלי מחיר יציאה אי אפשר לשמור אותה.
            </p>
          )}

          {/* The log. Every entry is stamped with the clock rather than with a
              field the trader fills in — the value of an event over an answer
              at the end is that it was recorded while it was true. When events
              exist they OVERRIDE the buttons above: a record beats a
              recollection, and the readout says which one is in force. */}
        </Group>

        {/* ── 3 · THE SETUP — why you entered ── */}
        <Group label="3 · הסטאפ">
          <Field label="מודל / סטאפ">
            {playbookSetups.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {playbookSetups.map(ps => (
                  <button
                    type="button" key={ps.id}
                    onClick={() => selectModel(ps.name)}
                    className={chipBtn(form.model === ps.name)}
                  >
                    {ps.name}
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
          </Field>

          <Field label="אישורי הכניסה">
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
            <div className="flex gap-2 max-w-xs mt-2">
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
          </Field>

          {/* Pre-filled from the direction declared on the entry gate, so for a
              trader who declares one this costs zero taps. Left blank it is
              simply not asked of the trade — which is a real answer and not
              the same as "aligned". */}
          <Field label="הכיוון שלך להיום (אופציונלי)">
            <div className="flex gap-1.5">
              {([
                ['BULLISH',    'עולה'],
                ['BEARISH',    'יורד'],
                ['INDECISIVE', 'ללא כיוון'],
              ] as [Bias, string][]).map(([b, he]) => (
                <button type="button" key={b} onClick={() => set('dayBias', form.dayBias === b ? '' : b)}
                  className={toggleBtn(form.dayBias === b,
                    b === 'BULLISH' ? 'border-[#22c55e]/60 bg-[#22c55e]/10 text-[#22c55e]'
                    : b === 'BEARISH' ? 'border-[#ef4444]/60 bg-[#ef4444]/10 text-[#ef4444]'
                    : 'border-white/25 bg-white/[0.04] text-white/60')}>
                  {he}
                </button>
              ))}
            </div>
            <p className="font-mono text-[11px] text-white/40 leading-relaxed mt-2">
              {form.dayBias === ''
                ? 'בלי כיוון מוצהר, העסקה לא נספרת כמיושרת ולא כמנוגדת — היא פשוט לא נשאלת.'
                : alignment === 'ALIGNED' ? 'העסקה הזו עם הכיוון שהגדרת.'
                : alignment === 'COUNTER' ? 'העסקה הזו נגד הכיוון שהגדרת.'
                : 'ללא כיוון אין למה להשוות, וזו תשובה תקפה.'}
            </p>
          </Field>
        </Group>

        {/* ── 4 · DISCIPLINE — clicks, not typing ── */}
        <Group label="4 · משמעת">
          {/* Deliberately unanswered by default, and deliberately not a
              checkbox: a checkbox has an implicit "no" and this question has
              three answers. Silence must stay distinguishable from "yes",
              otherwise every rule-adherence number becomes a flattering
              fiction built from the trades nobody bothered to grade. */}
          <Field label="עמדתי בחוקים שלי?" needed={!initial && form.followedRules === ''}>
            <div className="flex items-center gap-2">
              <FormResultBtn
                label="עמדתי" glyph="✓" active={form.followedRules === 'yes'}
                activeColor="#22c55e" activeBg="rgba(34,197,94,0.14)" activeBd="rgba(34,197,94,0.5)"
                onClick={() => setFollowedRules(form.followedRules === 'yes' ? '' : 'yes')}
              />
              <FormResultBtn
                label="סטיתי" glyph="✕" active={form.followedRules === 'no'}
                activeColor="#ef4444" activeBg="rgba(239,68,68,0.14)" activeBd="rgba(239,68,68,0.5)"
                onClick={() => setFollowedRules(form.followedRules === 'no' ? '' : 'no')}
              />
            </div>

            {/* Which ones. More than one can be broken in a single trade, so
                this is a multi-select — and each tick becomes a violation
                record on the rules page rather than a second copy of the same
                fact living on the trade. */}
            {form.followedRules === 'no' && (
              <div className="mt-3 onyx-pop-in">
                {activeRules.length > 0 ? (
                  <>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35 mb-2">אילו חוקים הפרת?</p>
                    <div className="flex flex-wrap gap-1.5">
                      {activeRules.map(r => (
                        <button type="button" key={r.id}
                          onClick={() => toggleBrokenRule(r.id)}
                          className={chipBtn(form.brokenRules.includes(r.id))}>
                          {ruleTitle(r)}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="font-mono text-[11px] text-white/30 leading-relaxed">
                    עדיין לא כתבת חוקים —{' '}
                    <Link href="/dashboard/rules" className="text-[#d4af37]/70 hover:text-[#d4af37] transition-colors">
                      כתוב את הראשון
                    </Link>{' '}
                    וכאן תוכל לסמן בדיוק מה הופר.
                  </p>
                )}
              </div>
            )}

            <p className="font-mono text-[11px] text-white/40 leading-relaxed mt-2">
              {form.followedRules === ''
                ? 'אם תדלג — העסקה לא תיספר לשני הכיוונים. עדיף לא לענות מאשר לענות לא נכון.'
                : 'התשובה שלך על העסקה הזו — לא נגזרת מהתוצאה.'}
            </p>
          </Field>

          <Field label="מצב רגשי לפני הכניסה" needed={!initial && form.emotionalState === ''}>
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
          </Field>
        </Group>

        {/* ── 5 · EVERYTHING ELSE — folded, so it is not in the way ── */}
        <div className="rounded-xl border border-white/[0.06]">
          <button
            type="button"
            onClick={() => setDetailsOpen(o => !o)}
            aria-expanded={detailsOpen}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-start"
          >
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/25">
              5 · פרטים נוספים
            </span>
            <span className="font-mono text-[11px] text-white/30">
              {detailsOpen ? 'סגור ✕' : 'נימוק · סטופ · צילום  ›'}
            </span>
          </button>

          {detailsOpen && (
            <div className="px-4 pb-4 space-y-5 onyx-pop-in">
              <Field label="מה גרם לך להיכנס?">
                <textarea
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="תאר את ה-setup, מה ראית בשוק, ומה עבר עליך מבחינה מנטלית..."
                  className={inputCls + ' resize-none'}
                  rows={3}
                  dir="rtl"
                />
              </Field>

              <Field label="הזדהות עם הסטופ">
                <textarea
                  value={form.stopNote}
                  onChange={e => set('stopNote', e.target.value)}
                  placeholder="למה דווקא שם? מתחת לפתיל, מעבר לאזור הנזילות, גודל קבוע..."
                  className={inputCls + ' resize-none'}
                  rows={2}
                  dir="rtl"
                />
              </Field>

              <Field label="צילום מסך">
                <ScreenshotUpload images={form.screenshots} onChange={sc => set('screenshots', sc)} />
              </Field>

              {/* Auto-detected context — informational only, nothing to choose.
                  The session lives next to the time it is derived from, up in
                  group 1; what is left here is the bias reading. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-white/30 pt-1">
                {form.dayBias && form.dayBias !== 'INDECISIVE' && (
                  <span>
                    הכיוון שהגדרת: <b className="text-white/60">{BIAS_HE[form.dayBias] ?? form.dayBias}</b>{' '}
                    {alignment === 'ALIGNED'
                      ? <span className="text-[#22c55e]">✓ מיושר</span>
                      : <span className="text-[#d4af37]">⚠ נגד הכיוון</span>}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        {/* What is still missing, named. A disabled button with no reason is a
            dead end — the trader cannot tell whether the form is broken or
            whether they are. Hidden while editing, where the rule does not
            apply. */}
        {!initial && missingRequired.length > 0 && (
          <p className="font-mono text-[11px] text-[#d4af37]/75 pt-1 leading-relaxed">
            עוד חסר: {missingRequired.join(' · ')}
            <span className="block text-white/30 mt-0.5">
              עסקה מתועדת אחרי שהיא נסגרה. לכל שאלה יש תשובה שמשמעותה &quot;לא קרה כלום&quot;.
            </span>
          </p>
        )}
        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 py-3.5 rounded-xl font-mono text-sm font-bold uppercase tracking-[0.14em] transition-all duration-200 bg-[#d4af37] text-black hover:bg-[#e5c84a] hover:scale-[1.01] [box-shadow:0_0_24px_rgba(212,175,55,0.25)] disabled:bg-[#3a3527] disabled:text-white/30 disabled:cursor-not-allowed disabled:[box-shadow:none] disabled:hover:scale-100"
          >
            {initial ? 'שמור שינויים' : 'שמור עסקה'}
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
