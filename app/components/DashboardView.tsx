'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The dashboard.
//
// A one-to-one build of design_handoff_onyx_dashboard: obsidian shell,
// floating panels with no borders anywhere, one accent. Every value lives in
// dashboard.css; this file is structure and data.
//
// WHAT IT DROPPED, DELIBERATELY. The widget palette and the customise/remove
// flow are gone with the old layout — the metric set is now composed, not
// assembled, and a grid the trader can empty cannot also be a design. The
// daily-bias selector and the "סיכום היום" strip were removed at the client's
// request before the redesign.
//
// EVERY NUMBER IS REAL. The prototype's figures were demo data; each one here
// is wired to the same source the statistics screen reads, so the two screens
// cannot disagree about the same account.
// ─────────────────────────────────────────────────────────────────────────────

import './dashboard.css';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { usePlan } from './PlanProvider';
import TraderSummary from './TraderSummary';
import InsightSection from './dashboard/InsightSection';
import { useCountUp, useReveal } from './dashboard/motion';
import { readOwned, writeOwned } from '../lib/sync/owned';
import { loadTrades, hydrateTradesFromCloud, tradePnL, rMultiple } from '../lib/journal';
import type { TradeEntry } from '../lib/journal';
import { activeZone, clockCaption, clockWithSecondsInZone, zoneShortName } from '../lib/time/zone';
import { hydrateDoc, initSyncListeners } from '../lib/sync/collections';
import { DEFAULT_SETTINGS, SETTINGS_KEY, SETTINGS_KIND, withDefaults } from '../lib/settings/types';
import type { UserSettings } from '../lib/settings/types';
import { activeSessions, getActiveSessionIdx } from '../lib/sessions';
import { INSTRUMENTS, pointValue } from '../lib/instruments';

/* ══════════════════════════════════════════════════════════════════
   Units and formatting
══════════════════════════════════════════════════════════════════ */

type Unit = 'dollar' | 'percent' | 'r' | 'ticks' | 'points';
const UNITS: Array<{ key: Unit; label: string }> = [
  { key: 'dollar', label: '$' },
  { key: 'percent', label: '%' },
  { key: 'r', label: 'R' },
  { key: 'ticks', label: 'Ticks' },
  { key: 'points', label: 'Points' },
];
const UNIT_KEY = 'onyx_dash2_unit';

interface FmtCtx { accountStart: number; avgRisk: number; avgTickValue: number; avgPointValue: number }

/** The average tick and point value across the instruments actually traded —
 *  so "Ticks" means the trader's own ticks and not ES's. */
function contractContext(trades: TradeEntry[]): { avgTickValue: number; avgPointValue: number } {
  const closed = trades.filter(t => t.result !== 'OPEN');
  if (!closed.length) return { avgTickValue: 12.5, avgPointValue: 50 };
  let tick = 0, point = 0, n = 0;
  for (const t of closed) {
    const inst = INSTRUMENTS[t.symbol as keyof typeof INSTRUMENTS];
    if (!inst) continue;
    point += pointValue(t.symbol as keyof typeof INSTRUMENTS);
    tick += pointValue(t.symbol as keyof typeof INSTRUMENTS) * inst.tickSize;
    n++;
  }
  return n ? { avgTickValue: tick / n, avgPointValue: point / n } : { avgTickValue: 12.5, avgPointValue: 50 };
}

/** A signed figure in the chosen unit. */
function fmt(usd: number, unit: Unit, c: FmtCtx): string {
  const sign = usd >= 0 ? '+' : '-';
  const a = Math.abs(usd);
  switch (unit) {
    case 'dollar':  return `${sign}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'percent': return `${sign}${(a / c.accountStart * 100).toFixed(2)}%`;
    case 'r':       return `${sign}${(a / (c.avgRisk || 1)).toFixed(2)}R`;
    case 'ticks':   return `${sign}${Math.round(a / (c.avgTickValue || 1)).toLocaleString('en-US')}t`;
    case 'points':  return `${sign}${(a / (c.avgPointValue || 1)).toFixed(2)}p`;
  }
}

/** The same figure, short enough for a 62px calendar cell.
 *
 *  The handoff's demo month carried a single "+$0", so nothing in it was ever
 *  wider than three characters. A real day total is "-$1,500.00", which at
 *  14px mono is wider than the cell it sits in and collides with the next one.
 *
 *  A day total has no business carrying cents anyway — it is a sum of trades,
 *  read at a glance — so they go, and anything past four figures goes to k.
 *  The cell keeps the design's type size and the grid keeps its 62px track. */
function fmtCell(usd: number, unit: Unit, c: FmtCtx): string {
  if (unit !== 'dollar') return fmt(usd, unit, c);
  const sign = usd >= 0 ? '+' : '-';
  const a = Math.abs(usd);
  // Six characters is what the 14px cell holds. Thousands go to k rather than
  // to a comma — "-$1.5k" fits where "-$1,500" does not, and a day total is
  // read for its size and sign, not to the dollar.
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}

/** The type size the month's longest day total fits in.
 *
 *  The handoff fixes a 62px track and 14px mono, and both are kept — but its
 *  demo month carried a single "+$0", so nothing in it was ever wider than
 *  three characters. Measured in the browser, a 62px cell holds 40px of text:
 *  four characters at 14px, five at 12px, six at 11px. So the month picks one
 *  size for all of its cells from its own longest value, and a month of
 *  ordinary days keeps the design's 14px.
 *
 *  One size for the whole month rather than per cell, or a calendar with a
 *  "+$0" beside a "-$1.5k" would set them in two different sizes. */
function fitDaySize(cells: string[]): { value: number; sub: number } {
  const longest = cells.reduce((n, t) => Math.max(n, t.length), 0);
  // The sub-line — "2t · הפסד" — is nine characters of Heebo and overruns the
  // same 40px at the handoff's 10.5px, in its own demo month as much as in a
  // real one. It gets its own step for the same reason.
  if (longest <= 4) return { value: 14, sub: 9.5 };
  if (longest === 5) return { value: 12, sub: 9 };
  return { value: 11, sub: 8.5 };
}

/** An absolute figure — the account balance, which carries no sign. */
function fmtAbs(usd: number, unit: Unit, c: FmtCtx): string {
  if (unit === 'dollar') return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (unit === 'percent') return `${(usd / c.accountStart * 100).toFixed(2)}%`;
  return fmt(usd - c.accountStart, unit, c);
}

/* ══════════════════════════════════════════════════════════════════
   Aggregation
══════════════════════════════════════════════════════════════════ */

interface Agg {
  pnl: number; closed: number; decided: number; wins: number; losses: number; bes: number;
  wr: number | null; pf: number | null; expectancy: number | null; avgR: number | null;
  maxDD: number; longPct: number | null; shortPct: number | null;
  streakTrades: number; streakDays: number;
  /** Distinct days with a closed trade, across the whole journal. */
  tradingDays: number;
  /** Only computed for the cards that can be switched on. */
  bestDay: number; tradesPerDay: number | null; avgWin: number; avgLoss: number;
}

function aggregate(trades: TradeEntry[]): Agg {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result === 'WIN');
  const losses = closed.filter(t => t.result === 'LOSS');
  const bes = closed.filter(t => t.result === 'BE');
  const decided = wins.length + losses.length;

  const pnlOf = (t: TradeEntry) => t.pnlUsd ?? tradePnL(t) ?? 0;
  const rOf = (t: TradeEntry) => t.tradeR ?? rMultiple(t) ?? 0;

  const winsPnl = wins.reduce((s, t) => s + Math.abs(pnlOf(t)), 0);
  const lossesPnl = losses.reduce((s, t) => s + Math.abs(pnlOf(t)), 0);
  const pnl = closed.reduce((s, t) => s + pnlOf(t), 0);

  const sorted = [...closed].sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time));
  let peak = 0, running = 0, maxDD = 0;
  for (const t of sorted) {
    running += pnlOf(t);
    if (running > peak) peak = running;
    if (peak - running > maxDD) maxDD = peak - running;
  }

  const longs = closed.filter(t => t.direction === 'LONG').length;
  const shorts = closed.filter(t => t.direction === 'SHORT').length;
  const dir = longs + shorts;

  const byDay = new Map<string, number>();
  for (const t of closed) byDay.set(t.dateISO, (byDay.get(t.dateISO) ?? 0) + pnlOf(t));
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let streakDays = 0;
  for (let i = days.length - 1; i >= 0; i--) { if (days[i][1] > 0) streakDays++; else break; }
  let streakTrades = 0;
  for (let i = sorted.length - 1; i >= 0; i--) { if (sorted[i].result === 'WIN') streakTrades++; else break; }

  return {
    pnl, closed: closed.length, decided, wins: wins.length, losses: losses.length, bes: bes.length,
    wr: decided ? (wins.length / decided) * 100 : null,
    pf: lossesPnl > 0 ? winsPnl / lossesPnl : (winsPnl > 0 ? Infinity : null),
    expectancy: closed.length ? pnl / closed.length : null,
    avgR: closed.length ? closed.reduce((s, t) => s + rOf(t), 0) / closed.length : null,
    maxDD,
    longPct: dir ? (longs / dir) * 100 : null,
    shortPct: dir ? (shorts / dir) * 100 : null,
    streakTrades, streakDays,
    tradingDays: byDay.size,
    bestDay: days.length ? Math.max(...days.map(d => d[1])) : 0,
    tradesPerDay: byDay.size ? closed.length / byDay.size : null,
    avgWin: wins.length ? winsPnl / wins.length : 0,
    avgLoss: losses.length ? lossesPnl / losses.length : 0,
  };
}

/* ══════════════════════════════════════════════════════════════════
   Component
══════════════════════════════════════════════════════════════════ */

const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const RING_C = 2 * Math.PI * 17;   // the handoff's 106.8

/* ── the metric set ────────────────────────────────────────────────────────
   Which cards the trader keeps, and in what order. The handoff's eight are
   the default; three more exist and are off until asked for.

   `primary` decides the card's weight — the handoff's big cards are the three
   headline figures and the win-rate ring, and everything else is a secondary
   card. It travels with the metric rather than with its position, so removing
   a card does not restyle the ones after it. */
type MetricKey =
  | 'pnl' | 'pf' | 'expectancy' | 'win'
  | 'avgrr' | 'maxdd' | 'longshort' | 'streak'
  | 'bestday' | 'tradesday' | 'avgwl';

const METRICS: Array<{ key: MetricKey; label: string; primary: boolean }> = [
  { key: 'pnl',        label: 'רווח נקי (P&L)',   primary: true  },
  { key: 'pf',         label: 'יחס רווח (PF)',    primary: true  },
  { key: 'expectancy', label: 'תוחלת עסקה',       primary: true  },
  { key: 'win',        label: 'אחוז הצלחה',       primary: true  },
  { key: 'avgrr',      label: 'יחס R ממוצע',      primary: false },
  { key: 'maxdd',      label: 'ירידה מקסימלית',   primary: false },
  { key: 'longshort',  label: 'לונג / שורט',      primary: false },
  { key: 'streak',     label: 'רצף מנצח',         primary: false },
  { key: 'bestday',    label: 'היום הכי טוב',     primary: false },
  { key: 'tradesday',  label: 'עסקאות ליום',      primary: false },
  { key: 'avgwl',      label: 'ממוצע רווח/הפסד',  primary: false },
];

const DEFAULT_CARDS: MetricKey[] = ['pnl', 'pf', 'expectancy', 'win', 'avgrr', 'maxdd', 'longshort', 'streak'];
const CARDS_KEY = 'onyx_dash3_cards';
const isMetricKey = (v: unknown): v is MetricKey => METRICS.some(m => m.key === v);

export default function DashboardView() {
  const { role, canAccess } = usePlan();
  const hasAi = canAccess('pro');
  const { user, isLoaded } = useUser();
  const firstName = isLoaded ? user?.firstName : undefined;

  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [clock, setClock] = useState('--:--:--');
  const [zoneCaption, setZoneCaption] = useState('שעון ישראל');
  // "IDT · UTC+3" — the abbreviation the trader reads on a clock, next to the
  // offset that decides which abbreviation is true. Both come from the zone
  // they chose, so a trader on New York time is not told it is Israel's.
  const [zoneStamp, setZoneStamp] = useState('');
  const [unit, setUnit] = useState<Unit>('dollar');
  const [cards, setCards] = useState<MetricKey[]>(DEFAULT_CARDS);
  const [editing, setEditing] = useState(false);
  /** Nothing is written back until what was stored has been read AND applied.
   *
   *  WITHOUT THIS THE PREFERENCE ERASES ITSELF. The read and the write are two
   *  effects in the same mount flush: the read fires first and QUEUES its
   *  state, then the write fires with the default still in scope and puts it
   *  over the stored value. The next mount reads back that default — and under
   *  React's development double-invoke that next mount is immediate, so it
   *  happened on every load: eleven cards chosen, eight after a refresh, and
   *  localStorage holding the eight it had just overwritten itself with.
   *
   *  It is STATE and not a ref on purpose. A ref set at the end of the read
   *  effect is already true by the time the write effect runs in that same
   *  flush, which is the same bug with an extra line — measured, not assumed.
   *  Flipping state forces a re-render, so the first write sees the value the
   *  read actually installed. */
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<number>(-1);
  const [monthCursor, setMonthCursor] = useState<Date>(() => { const d = new Date(); d.setDate(1); return d; });
  const [macro, setMacro] = useState<MacroEvent[] | null>(null);
  const [macroToday, setMacroToday] = useState<string | null>(null);

  const sessions = useMemo(() => activeSessions(), []);
  const p = useCountUp();

  /* ── clock ─────────────────────────────────────────────────── */
  useEffect(() => {
    const tick = () => setClock(prev => { const next = clockWithSecondsInZone(); return next === prev ? prev : next; });
    tick();
    setZoneCaption(clockCaption());
    setZoneStamp(`${zoneShortName()} · ${utcOffsetLabel(activeZone())}`);
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  /* ── data ──────────────────────────────────────────────────── */
  useEffect(() => {
    const u = readOwned<Unit>(UNIT_KEY);
    if (u && UNITS.some(x => x.key === u)) setUnit(u);
    const c = readOwned<unknown[]>(CARDS_KEY);
    if (Array.isArray(c)) {
      const kept = c.filter(isMetricKey);
      // An empty saved set would render a blank column with no way back, so
      // the default stands until at least one card is chosen.
      if (kept.length) setCards(kept);
    }
    setSession(getActiveSessionIdx());
    setTrades(loadTrades());
    initSyncListeners();
    hydrateTradesFromCloud().then(m => { if (m) setTrades(m); }).catch(() => {});
    hydrateDoc<UserSettings>(SETTINGS_KIND, SETTINGS_KEY)
      .then(doc => { if (doc) setSettings(withDefaults(doc)); })
      .catch(() => { /* the default stands until it arrives */ });
    fetch('/api/macro?scope=week')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { setMacro(Array.isArray(d?.events) ? d.events : []); setMacroToday(typeof d?.today === 'string' ? d.today : null); })
      .catch(() => setMacro([]));
    setReady(true);
  }, []);

  useEffect(() => { if (ready) writeOwned(UNIT_KEY, unit); }, [ready, unit]);
  useEffect(() => { if (ready) writeOwned(CARDS_KEY, cards); }, [ready, cards]);

  /* ── derived ───────────────────────────────────────────────── */
  const accountStart = settings.accountStartUsd || DEFAULT_SETTINGS.accountStartUsd;
  const stats = useMemo(() => aggregate(trades), [trades]);
  const cctx = useMemo(() => contractContext(trades), [trades]);

  const avgRisk = useMemo(() => {
    const closed = trades.filter(t => t.result !== 'OPEN');
    let sum = 0, n = 0;
    for (const t of closed) {
      const usd = Math.abs(t.pnlUsd ?? tradePnL(t) ?? 0);
      const r = Math.abs(t.tradeR ?? rMultiple(t) ?? 0);
      if (r > 0) { sum += usd / r; n++; }
    }
    return n ? sum / n : 100;
  }, [trades]);

  const ctx: FmtCtx = { accountStart, avgRisk, ...cctx };

  /* ── the month: calendar, monthly change, equity curve ─────── */
  const cal = useMemo(() => buildCalendar(trades, monthCursor), [trades, monthCursor]);
  const curve = useMemo(() => equityCurve(trades), [trades]);
  // Every day total the visible month will print, so the cells can agree on a
  // size that fits the longest of them. See fitDaySize.
  const daySize = useMemo(
    () => fitDaySize(cal.rows.flatMap(r => r.days.filter(d => d.n > 0).map(d => fmtCell(d.pnl, unit, ctx)))),
    [cal.rows, unit, ctx],
  );

  const monthLabel = useMemo(
    () => monthCursor.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' }),
    [monthCursor],
  );

  const dateStr = useMemo(
    () => new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }),
    [],
  );

  const hour = parseInt(clock.slice(0, 2), 10) || 0;
  const greetWord = hour < 5 || hour >= 22 ? 'לילה טוב'
    : hour < 12 ? 'בוקר טוב'
    : hour < 18 ? 'צהריים טובים'
    : 'ערב טוב';

  const activeSess = session >= 0 ? sessions[session] : null;

  const macroRows = useMemo(
    () => (macro ?? [])
      .filter(e => e.impact === 'High' && e.currency === 'USD')
      .sort((a, b) => (a.dateIsrael + a.timeIsrael).localeCompare(b.dateIsrael + b.timeIsrael)),
    [macro],
  );

  useReveal([trades.length, hasAi, cal.rows.length, macroRows.length]);

  return (
    <div className="dsh" dir="rtl">
      <main className="dsh-main">

        {/* ── header ─────────────────────────────────────────── */}
        <header className="dsh-header">
          <div className="dsh-crumb">
            <span className="dsh-crumb-mark">◈</span>
            <span className="dsh-crumb-brand">ONYX</span>
            <span className="dsh-crumb-sep">/</span>
            <span className="dsh-crumb-page">לוח בקרה</span>
          </div>
          <div className="dsh-header-right">
            <span className="dsh-plan">{role.toUpperCase()}</span>
            {/* It opens the metric picker below. It used to be a link straight
                to Settings, which is not what "customise" means on a screen
                made of cards the trader chooses. */}
            <button
              type="button"
              className={`dsh-btn${editing ? ' is-on' : ''}`}
              aria-expanded={editing}
              onClick={() => setEditing(v => !v)}
            >
              {editing ? 'סיימתי' : 'התאמה אישית'}
            </button>
            <Link href="/dashboard/settings" className="dsh-sq" aria-label="הגדרות">◇</Link>
          </div>
        </header>

        {/* ── greeting + clock ───────────────────────────────── */}
        <section className="dsh-greet" data-reveal="1">
          <div className="dsh-bloom is-greet" aria-hidden />
          <div className="dsh-sweep" aria-hidden />
          <div className="dsh-greet-col">
            <div className="dsh-dateline">
              <span className="dsh-live-dot" aria-hidden />
              <span className="dsh-date">{dateStr}</span>
            </div>
            <h1 className="dsh-h1">{firstName ? `${greetWord}, ${firstName}` : greetWord}</h1>
            <div className="dsh-chips">
              {activeSess && (
                <span className="dsh-chip is-gold">
                  <span className="dsh-chip-dot" aria-hidden />
                  {activeSess.he} פעילה כעת
                </span>
              )}
              <span className="dsh-chip is-plain">
                <span className="dsh-chip-n dsh-ltr">{trades.length}</span> עסקאות
              </span>
            </div>
          </div>
          <div className="dsh-clock">
            <div className="dsh-clock-k">{zoneCaption}</div>
            <div className="dsh-clock-v dsh-ltr">{clock}</div>
            <div className="dsh-clock-z dsh-ltr">{zoneStamp}</div>
          </div>
        </section>

        {/* ── the summary, in sentences, before any tile ─────── */}
        {hasAi && <TraderSummary trades={trades} accountStart={accountStart} />}

        {/* ── selectors ──────────────────────────────────────── */}
        <section className="dsh-selectors" data-reveal="1">
          <div className="dsh-seg" role="group" aria-label="סשן">
            {sessions.map((sess, i) => (
              <button
                key={sess.key} type="button" className="dsh-sess"
                aria-pressed={i === session}
                onClick={() => setSession(i)}
              >
                <span className="dsh-sess-dot" aria-hidden />
                {sess.he}
              </button>
            ))}
          </div>
          <div className="dsh-unit-wrap">
            <span className="dsh-unit-k">תצוגה לפי</span>
            <div className="dsh-unit-track" role="group" aria-label="תצוגה לפי">
              {UNITS.map(u => (
                <button
                  key={u.key} type="button" className="dsh-unit"
                  aria-pressed={unit === u.key}
                  onClick={() => setUnit(u.key)}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── the metric picker ──────────────────────────────── */}
        {editing && (
          <section className="dsh-picker" aria-label="בחירת מדדים">
            <div className="dsh-picker-k"><span>◈</span>אילו מדדים להציג</div>
            <div className="dsh-picker-grid">
              {METRICS.map(m => {
                const on = cards.includes(m.key);
                return (
                  <button
                    key={m.key} type="button" className="dsh-pick" aria-pressed={on}
                    onClick={() => setCards(cs => (
                      cs.includes(m.key)
                        // The last card cannot be removed — an empty column has
                        // no affordance to bring anything back.
                        ? (cs.length > 1 ? cs.filter(k => k !== m.key) : cs)
                        : [...cs, m.key]
                    ))}
                  >
                    <span className="dsh-pick-mark">{on ? '✓' : '+'}</span>{m.label}
                  </button>
                );
              })}
            </div>
            <p className="dsh-picker-note">
              הבחירה נשמרת רק אצלך ומשפיעה על התצוגה בלבד — לא על נתוני המסחר.
            </p>
          </section>
        )}

        {/* ── balance + curve + metrics ──────────────────────── */}
        <section className="dsh-split" data-reveal="1">
          <div className="dsh-balance">
            <div className="dsh-bloom is-balance" aria-hidden />
            <div className="dsh-balance-body">
              <div className="dsh-balance-k">יתרת חשבון</div>
              <div className="dsh-balance-v dsh-ltr">
                {fmtAbs(accountStart + stats.pnl * p, unit, ctx)}
              </div>
              {/* THE CHANGE THAT PRODUCED THE BALANCE ABOVE, not the month's.
                  It used to read the calendar's month, which meant two things
                  went wrong at once: browsing the calendar to another month
                  silently rewrote the balance's delta, and an account whose
                  trades are all in earlier months was told "0.00%" directly
                  under a balance that was plainly up. The number under a
                  figure has to be the one that made it. */}
              <div className="dsh-balance-row">
                <span
                  className="dsh-balance-delta dsh-ltr"
                  style={{ color: stats.pnl >= 0 ? 'var(--d-green)' : 'var(--d-red)' }}
                >
                  {fmt(stats.pnl * p, unit, ctx)}
                </span>
                <span className="dsh-balance-note">
                  שינוי מאז הפתיחה · <span className="dsh-ltr">{((stats.pnl / accountStart) * 100 * p).toFixed(2)}%</span> · {stats.tradingDays} ימי מסחר
                </span>
              </div>
            </div>
            {/* The equity curve. One series, so no legend — the balance above
                names it — and one mark, at the end, where the account stands
                now. The baseline is the opening balance, drawn only when the
                account has been on both sides of it. */}
            <div className="dsh-curve">
              <svg viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} preserveAspectRatio="none" aria-hidden>
                <defs>
                  <linearGradient id="dsh-eq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d4af37" stopOpacity="0.18" />
                    <stop offset="84%" stopColor="#d4af37" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {curve.baseY !== null && (
                  <line
                    className="dsh-curve-base" x1="0" x2={CURVE_W}
                    y1={curve.baseY} y2={curve.baseY} vectorEffect="non-scaling-stroke"
                  />
                )}
                {curve.area && <path d={curve.area} fill="url(#dsh-eq)" />}
                <path
                  className="dsh-curve-line" d={curve.line} fill="none" stroke="#d4af37"
                  strokeWidth="1.6" vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round" strokeLinecap="round"
                  strokeDasharray="1700"
                />
              </svg>
              {/* Outside the stretched viewBox, so the dot stays a circle:
                  preserveAspectRatio="none" would squash anything drawn in it. */}
              {/* Clamped a dot's radius inside the box: the path bleeds to the
                  panel edges by design, and the panel clips its overflow, so an
                  unclamped end mark is half a dot. */}
              <span
                className="dsh-curve-end"
                style={{
                  left: `min(${((curve.end.x / CURVE_W) * 100).toFixed(2)}%, calc(100% - 7px))`,
                  top: `clamp(7px, ${((curve.end.y / CURVE_H) * 100).toFixed(2)}%, calc(100% - 7px))`,
                }}
              />
            </div>
          </div>

          <div className="dsh-metrics">
            {cards.map(key => (
              <MetricCard
                key={key} metric={key} stats={stats} unit={unit} ctx={ctx} p={p}
                editing={editing}
                onDrop={() => setCards(cs => (cs.length > 1 ? cs.filter(k => k !== key) : cs))}
              />
            ))}
          </div>
        </section>

        {/* ── daily note + coach rail ────────────────────────── */}
        <InsightSection locked={!hasAi} />

        {/* ── journal + macro ────────────────────────────────── */}
        <section className="dsh-wide" data-reveal="1">
          <div className="dsh-journal">
            <div className="dsh-journal-head">
              <h2 className="dsh-h2">יומן מסחר · {monthLabel}</h2>
              <span className="dsh-journal-meta">
                <span className="dsh-journal-pnl">
                  P&amp;L חודשי{' '}
                  <b
                    className="dsh-ltr"
                    style={{ color: cal.monthDays === 0 ? 'var(--d-faint-1)' : cal.monthPnl >= 0 ? 'var(--d-green)' : 'var(--d-red)' }}
                  >
                    {cal.monthDays === 0 ? '—' : fmt(cal.monthPnl, unit, ctx)}
                  </b>
                </span>
                <span className="dsh-journal-days">{cal.monthDays} ימי מסחר</span>
                {/* The earlier month is to the RIGHT and its chevron points
                    that way; the next month is to the LEFT and points left.
                    Drawn rather than typed: ‹ and › are in the bidi mirroring
                    table, so in an RTL run the browser flips them and the back
                    button ends up pointing forward. */}
                <span className="dsh-monthnav">
                  <button type="button" aria-label="חודש קודם" onClick={() => setMonthCursor(m => shiftMonth(m, -1))}>
                    <Chevron dir="right" />
                  </button>
                  <button type="button" aria-label="חודש הבא" onClick={() => setMonthCursor(m => shiftMonth(m, 1))}>
                    <Chevron dir="left" />
                  </button>
                </span>
              </span>
            </div>

            <div className="dsh-cal-scroll">
              <div
                className="dsh-cal"
                style={{
                  ['--dsh-day-fs' as string]: `${daySize.value}px`,
                  ['--dsh-sub-fs' as string]: `${daySize.sub}px`,
                }}
              >
                {DOW.map(d => <div key={d} className="dsh-dow">{d}</div>)}
                <div className="dsh-dow">שבוע</div>

                {cal.rows.map(row => (
                  <FragmentRow key={row.week} row={row} unit={unit} ctx={ctx} />
                ))}
              </div>
            </div>

            <div className="dsh-legend">
              <span><span className="dsh-swatch" style={{ background: 'rgba(95,156,114,.3)' }} />יום עם רווח</span>
              <span><span className="dsh-swatch" style={{ background: 'rgba(163,74,74,.3)' }} />יום עם הפסד</span>
              <span><span className="dsh-swatch" style={{ background: 'rgba(255,255,255,.06)' }} />בלי מסחר</span>
            </div>
          </div>

          <div className="dsh-macro">
            <div className="dsh-macro-head">
              <span className="dsh-h">דוחות מאקרו · USD</span>
              <span className="dsh-macro-right">
                <span className="dsh-macro-pill"><span className="dsh-macro-pill-dot" aria-hidden />השפעה גבוהה</span>
                <Link href="/dashboard/reports" className="dsh-macro-all">לכל הדוחות ←</Link>
              </span>
            </div>

            {macroRows.length === 0 ? (
              <div className="dsh-macro-empty">
                <div className="dsh-macro-empty-t">אין אירועים בעלי השפעה גבוהה השבוע</div>
                <div className="dsh-macro-empty-s">השבוע הבא נטען אוטומטית ביום ראשון</div>
              </div>
            ) : (
              <div className="dsh-macro-list">
                {macroRows.slice(0, 8).map((e, i) => (
                  <div className="dsh-macro-row" key={`${e.dateIsrael}-${e.title}-${i}`}>
                    <span className="dsh-macro-dot" aria-hidden />
                    <span className="dsh-macro-day">
                      {e.dateIsrael === macroToday ? 'היום' : weekdayShort(e.dateIsrael)}
                    </span>
                    <span>
                      <span className="dsh-macro-t">{e.title}</span>
                      <span className="dsh-macro-cur dsh-ltr">{e.currency}</span>
                    </span>
                    <span className="dsh-macro-time dsh-ltr">{e.timeIsrael || '—'}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="dsh-macro-foot">
              שעות בזמן ישראל. הדוחות מסומנים על היומן אוטומטית ביום שבו הם מתפרסמים.
            </p>
          </div>
        </section>

        <footer className="dsh-footer">
          מסחר כרוך בסיכון מהותי · הכלים במערכת נועדו למטרות לימוד ומחקר · השימוש באחריות המשתמש
        </footer>
      </main>
    </div>
  );
}

/** A chevron that stays pointing where it is told.
 *
 *  ‹ and › are bidi-mirrored characters: typed into an RTL run, the browser
 *  renders them the other way round, which is how the back button came to
 *  point forward. */
function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === 'right' ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════
   One metric card
══════════════════════════════════════════════════════════════════ */

/** Every card in the metric column, in the handoff's two weights.
 *
 *  Kept in one place so a card the trader adds later carries the same shell,
 *  the same hover and the same remove affordance as the eight that ship on. */
function MetricCard({
  metric, stats, unit, ctx, p, editing, onDrop,
}: {
  metric: MetricKey; stats: Agg; unit: Unit; ctx: FmtCtx; p: number;
  editing: boolean; onDrop: () => void;
}) {
  const meta = METRICS.find(m => m.key === metric)!;
  const shell = meta.primary ? 'dsh-card' : 'dsh-card2';
  const kCls = meta.primary ? 'dsh-card-k' : 'dsh-card2-k';
  const vCls = meta.primary ? 'dsh-card-v' : 'dsh-card2-v';
  const nCls = meta.primary ? 'dsh-card-n' : 'dsh-card2-n';

  const drop = editing ? (
    <button type="button" className="dsh-drop" onClick={onDrop} aria-label={`הסר ${meta.label}`}>×</button>
  ) : null;

  const plain = (value: string, color: string, note: string) => (
    <div className={shell}>
      {drop}
      <span className={kCls}>{meta.label}</span>
      <span className={`${vCls} dsh-ltr`} style={{ color }}>{value}</span>
      <span className={`${nCls} dsh-ltr`}>{note}</span>
    </div>
  );

  switch (metric) {
    case 'pnl':
      return plain(fmt(stats.pnl * p, unit, ctx), stats.pnl >= 0 ? 'var(--d-green)' : 'var(--d-red)', `${stats.closed} TRADES`);
    case 'pf':
      return plain(
        stats.pf == null ? '—' : stats.pf === Infinity ? '∞' : (stats.pf * p).toFixed(2),
        'var(--d-white)', 'PROFIT FACTOR',
      );
    case 'expectancy':
      return plain(
        stats.expectancy == null ? '—' : fmt(stats.expectancy * p, unit, ctx).replace(/^\+/, ''),
        'var(--d-gold-light)', 'EXPECTANCY',
      );
    case 'avgrr':
      return plain(
        stats.avgR == null ? '—' : `${stats.avgR >= 0 ? '+' : ''}${(stats.avgR * p).toFixed(2)}R`,
        'var(--d-hi-2)', 'AVG R',
      );
    case 'maxdd':
      return plain(stats.maxDD > 0 ? fmt(-stats.maxDD * p, unit, ctx) : '—', 'var(--d-red)', 'MAX DRAWDOWN');
    case 'bestday':
      return plain(
        stats.bestDay === 0 ? '—' : fmt(stats.bestDay * p, unit, ctx),
        stats.bestDay >= 0 ? 'var(--d-green)' : 'var(--d-red)', 'BEST DAY',
      );
    case 'tradesday':
      return plain(
        stats.tradesPerDay == null ? '—' : (stats.tradesPerDay * p).toFixed(1),
        'var(--d-hi-2)', 'TRADES / DAY',
      );

    case 'win': {
      const wr = stats.wr ?? 0;
      const filled = (wr / 100) * RING_C;
      return (
        <div className="dsh-card is-win">
          {drop}
          <div className="dsh-win-left">
            <span className="dsh-card-k">{meta.label}</span>
            <span className="dsh-win-legend">
              <span style={{ color: 'var(--d-green)' }}>W {stats.wins}</span>
              <span style={{ color: 'var(--d-low-1)' }}>BE {stats.bes}</span>
              <span style={{ color: 'var(--d-red)' }}>L {stats.losses}</span>
            </span>
          </div>
          <div className="dsh-ring">
            <svg viewBox="0 0 42 42" aria-hidden>
              <circle cx="21" cy="21" r="17" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="4" />
              <circle
                className="dsh-ring-arc" cx="21" cy="21" r="17" fill="none"
                stroke="#d4af37" strokeWidth="4" strokeLinecap="butt"
                strokeDasharray={RING_C}
                style={{ ['--dsh-ring-to' as string]: String(RING_C - filled) }}
              />
            </svg>
            <span className="dsh-ring-v dsh-ltr">{stats.wr == null ? '—' : `${Math.round(wr * p)}%`}</span>
          </div>
        </div>
      );
    }

    case 'longshort':
      return (
        <div className="dsh-card2 is-pair">
          {drop}
          <span className="dsh-card2-k">{meta.label}</span>
          <span className="dsh-ls-row dsh-ltr">
            <span style={{ color: 'var(--d-green)' }}>{stats.longPct == null ? '—' : `${Math.round(stats.longPct)}%`}</span>
            <span className="dsh-ls-slash">/</span>
            <span style={{ color: 'var(--d-red)' }}>{stats.shortPct == null ? '—' : `${Math.round(stats.shortPct)}%`}</span>
          </span>
          <span className="dsh-ls-bar">
            <span className="dsh-ls-long" style={{ width: `${stats.longPct ?? 50}%` }} />
            <span className="dsh-ls-short" style={{ width: `${stats.shortPct ?? 50}%` }} />
          </span>
        </div>
      );

    case 'streak':
      return (
        <div className="dsh-card2 is-pair">
          {drop}
          <span className="dsh-card2-k">{meta.label}</span>
          <span className="dsh-streak">
            <span className="dsh-streak-cell">
              <span className="dsh-streak-v dsh-ltr" style={{ color: 'var(--d-hi-2)' }}>{stats.streakTrades}</span>
              <span className="dsh-streak-k">עסקאות</span>
            </span>
            <span className="dsh-streak-cell">
              <span className="dsh-streak-v dsh-ltr" style={{ color: 'var(--d-mid-1)' }}>{stats.streakDays}</span>
              <span className="dsh-streak-k">ימים</span>
            </span>
          </span>
        </div>
      );

    case 'avgwl':
      return (
        <div className="dsh-card2 is-pair">
          {drop}
          <span className="dsh-card2-k">{meta.label}</span>
          <span className="dsh-ls-row dsh-ltr">
            <span style={{ color: 'var(--d-green)' }}>{fmt(stats.avgWin * p, unit, ctx)}</span>
            <span className="dsh-ls-slash">/</span>
            <span style={{ color: 'var(--d-red)' }}>{fmt(-stats.avgLoss * p, unit, ctx)}</span>
          </span>
          <span className="dsh-card2-n dsh-ltr">AVG WIN / LOSS</span>
        </div>
      );
  }
}

/* ══════════════════════════════════════════════════════════════════
   Calendar
══════════════════════════════════════════════════════════════════ */

interface DayCell { day: number | null; pnl: number; n: number; ticks: number }
interface WeekRow { week: number; days: DayCell[]; pnl: number; n: number; has: boolean }

interface MacroEvent { title: string; currency: string; impact: 'High' | 'Medium' | 'Low' | 'Holiday'; dateIsrael: string; timeIsrael: string }

function shiftMonth(from: Date, by: number): Date {
  const d = new Date(from);
  d.setDate(1);
  d.setMonth(d.getMonth() + by);
  return d;
}

/** "UTC+3" for the zone as it stands right now, daylight saving included. */
function utcOffsetLabel(zone: string, now: Date = new Date()): string {
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const local = new Date(now.toLocaleString('en-US', { timeZone: zone }));
  const mins = Math.round((local.getTime() - utc.getTime()) / 60_000);
  const sign = mins < 0 ? '-' : '+';
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

function weekdayShort(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('he-IL', { weekday: 'short' });
}

/** The month's grid, its totals, and the equity curve drawn over it.
 *
 *  Row count comes from the month — `ceil((firstDow + daysInMonth) / 7)` —
 *  never a hardcoded five, or October 2026 loses its last row. */
function buildCalendar(trades: TradeEntry[], cursor: Date) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const dim = new Date(year, month + 1, 0).getDate();

  const byDay = new Map<number, { pnl: number; n: number; ticks: number }>();
  for (const t of trades) {
    if (t.result === 'OPEN') continue;
    const d = new Date(`${t.dateISO}T12:00:00`);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const key = d.getDate();
    const cur = byDay.get(key) ?? { pnl: 0, n: 0, ticks: 0 };
    cur.pnl += t.pnlUsd ?? tradePnL(t) ?? 0;
    cur.n += 1;
    byDay.set(key, cur);
  }

  const rowCount = Math.ceil((firstDow + dim) / 7);
  const rows: WeekRow[] = [];
  let day = 1;
  for (let w = 0; w < rowCount; w++) {
    const days: DayCell[] = [];
    let pnl = 0, n = 0, has = false;
    for (let col = 0; col < 7; col++) {
      if ((w === 0 && col < firstDow) || day > dim) { days.push({ day: null, pnl: 0, n: 0, ticks: 0 }); continue; }
      const info = byDay.get(day);
      if (info) { pnl += info.pnl; n += info.n; has = true; }
      days.push({ day, pnl: info?.pnl ?? 0, n: info?.n ?? 0, ticks: info?.ticks ?? 0 });
      day++;
    }
    rows.push({ week: w + 1, days, pnl, n, has });
  }

  const monthPnl = [...byDay.values()].reduce((s, d) => s + d.pnl, 0);
  const monthDays = byDay.size;

  return { rows, monthPnl, monthDays };
}

/** The account's equity, drawn onto the handoff's 600×170 box.
 *
 *  THE WHOLE JOURNAL, not the calendar's month. The curve sits under the
 *  balance and its since-opening change, so a month's worth of it under a
 *  since-opening figure would be a third number disagreeing with the two above
 *  it — and on an account whose trading was in earlier months it drew a flat
 *  line, which reads as broken rather than as empty.
 *
 *  Left to right, and NOT mirrored in RTL: an equity curve reads forward in
 *  time whichever way the page runs. */
interface Curve {
  /** The line itself, as a smoothed path. */
  line: string;
  /** The same path closed to the floor, for the wash underneath it. */
  area: string;
  /** Where the account stands now — the one point worth a mark. */
  end: { x: number; y: number };
  /** The opening balance, as a y in the same box. Null when it is off-scale. */
  baseY: number | null;
}

/* CURVE_TOP is the headroom above the highest point. It was 14 of 170 — under
   a tenth of the box — which put a rising account's peak within a few pixels
   of the panel's own text. The line is the panel's quietest element and has no
   business crowding the balance. */
const CURVE_W = 600, CURVE_H = 170, CURVE_TOP = 30, CURVE_BOTTOM = 158;

/** A monotone cubic through the points — the classic equity-curve line.
 *
 *  Straight segments between daily closes made the curve read as a saw: every
 *  join a hard corner, and at twenty-odd points the whole thing looked like a
 *  chart of nothing in particular. A monotone fit rounds the joins WITHOUT
 *  overshooting, which matters here: a curve that bulges past a day's real
 *  balance is drawing money the account never had. */
function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;

  // Tangents by Fritsch–Carlson: zero at every local extreme, so the line
  // flattens into a peak or a trough instead of sailing through it.
  const n = pts.length;
  const dx: number[] = [], dy: number[] = [], slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    dy.push(pts[i + 1].y - pts[i].y);
    slope.push(dy[i] / (dx[i] || 1));
  }
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  }
  m.push(slope[n - 2]);

  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const c = dx[i] / 3;
    d += ` C${(pts[i].x + c).toFixed(2)},${(pts[i].y + m[i] * c).toFixed(2)}`
      +  ` ${(pts[i + 1].x - c).toFixed(2)},${(pts[i + 1].y - m[i + 1] * c).toFixed(2)}`
      +  ` ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

function equityCurve(trades: TradeEntry[]): Curve {
  const flat: Curve = {
    line: `M0,${CURVE_BOTTOM} L${CURVE_W},${CURVE_BOTTOM}`,
    area: '', end: { x: CURVE_W, y: CURVE_BOTTOM }, baseY: null,
  };

  const byDay = new Map<string, number>();
  for (const t of trades) {
    if (t.result === 'OPEN') continue;
    byDay.set(t.dateISO, (byDay.get(t.dateISO) ?? 0) + (t.pnlUsd ?? tradePnL(t) ?? 0));
  }
  const ordered = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (ordered.length === 0) return flat;

  // Starts at the opening balance — zero cumulative — so the first day is a
  // move rather than the baseline.
  let cum = 0;
  const cums = [0, ...ordered.map(([, v]) => (cum += v))];
  const lo = Math.min(...cums), hi = Math.max(...cums);
  // A flat account has no range to scale by; draw it on the baseline rather
  // than dividing by zero into the middle of the box.
  const range = hi - lo;
  const y = (v: number) => (range === 0
    ? CURVE_BOTTOM
    : CURVE_BOTTOM - ((v - lo) / range) * (CURVE_BOTTOM - CURVE_TOP));

  const step = CURVE_W / (cums.length - 1);
  const pts = cums.map((v, i) => ({ x: +(i * step).toFixed(2), y: +y(v).toFixed(2) }));

  const line = smoothPath(pts);
  return {
    line,
    area: `${line} L${CURVE_W},${CURVE_H} L0,${CURVE_H} Z`,
    end: pts[pts.length - 1],
    // Only worth drawing when the account has been both above and below it.
    baseY: range > 0 && lo < 0 && hi > 0 ? +y(0).toFixed(2) : null,
  };
}

/** One calendar row: seven days and the week's summary cell. */
function FragmentRow({ row, unit, ctx }: { row: WeekRow; unit: Unit; ctx: FmtCtx }) {
  return (
    <>
      {row.days.map((c, i) => {
        if (c.day === null) return <div key={`e${row.week}-${i}`} className="dsh-day is-out" aria-hidden />;
        const traded = c.n > 0;
        const cls = traded ? (c.pnl >= 0 ? ' is-profit' : ' is-loss') : '';
        return (
          <div key={`d${row.week}-${i}`} className={`dsh-day${cls}`}>
            <span className="dsh-day-n dsh-ltr">{c.day}</span>
            {traded && (
              <span className="dsh-day-b">
                <span className="dsh-day-v dsh-ltr">{fmtCell(c.pnl, unit, ctx)}</span>
                <span className="dsh-day-s">{c.n}t · {c.pnl >= 0 ? 'רווח' : 'הפסד'}</span>
              </span>
            )}
          </div>
        );
      })}
      <div className="dsh-week">
        <span className="dsh-week-n">שבוע {row.week}</span>
        <span className="dsh-day-b">
          <span
            className={`dsh-day-v dsh-week-v dsh-ltr${row.has ? '' : ' is-empty'}`}
            style={row.has ? { color: row.pnl >= 0 ? 'var(--d-green)' : 'var(--d-red)' } : undefined}
          >
            {row.has ? fmtCell(row.pnl, unit, ctx) : '—'}
          </span>
          {row.n > 0 && <span className="dsh-day-s">{row.n} עסקאות</span>}
        </span>
      </div>
    </>
  );
}
