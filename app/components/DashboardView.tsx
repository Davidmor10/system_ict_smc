'use client';

import './dp.css';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { useLanguage } from '../hooks/useLanguage';
import { usePlan } from './PlanProvider';
import { loadTrades, hydrateTradesFromCloud, tradePnL, rMultiple } from '../lib/journal';
import type { TradeEntry } from '../lib/journal';
import { initSyncListeners } from '../lib/sync/collections';
import { SESS, getActiveSessionIdx } from '../lib/sessions';
import { INSTRUMENTS, pointValue } from '../lib/instruments';

/* ══════════════════════════════════════════════════════════════════
   Types & constants
══════════════════════════════════════════════════════════════════ */
type Lang = 'he' | 'en';
type Unit = 'dollar' | 'percent' | 'r' | 'ticks' | 'points';
type WidgetKey = 'balance' | 'pnl' | 'pf' | 'win' | 'expectancy' | 'avgrr' | 'streak' | 'maxdd' | 'longshort' | 'bestday' | 'tradesday' | 'avgwl';

const DEFAULT_WIDGETS: WidgetKey[] = ['balance', 'pnl', 'pf', 'win', 'expectancy', 'avgrr', 'streak', 'maxdd', 'longshort'];
const ACCOUNT_START_DEFAULT = 25000;
const WIDGETS_KEY = 'onyx_dash2_widgets';
const UNIT_KEY = 'onyx_dash2_unit';

type ConfidenceLevel = 'low' | 'medium' | 'high';
interface AiDiscovery { title: string; evidence: string; action: string; confidenceLevel: ConfidenceLevel; sampleSize: number; }
interface MacroEventLite { title: string; currency: string; impact: 'High' | 'Medium' | 'Low' | 'Holiday'; dateIsrael: string; timeIsrael: string; }

const STR = {
  he: {
    edit: '⊞ התאמה אישית', editOn: '✓ שמור לוח', brand: 'ONYX · לוח בקרה', settings: 'הגדרות',
    greetMorning: 'בוקר טוב', greetAfternoon: 'צהריים טובים', greetEvening: 'ערב טוב', greetNight: 'לילה טוב',
    sessionActive: (n: string) => `${n} פעילה כעת`, noSession: 'אין סשן פעיל',
    clockLabel: 'שעון ישראל', tradesLabel: 'עסקאות', importLast: 'יבוא אחרון',
    unitLabel: 'תצוגה לפי',
    liveTag: 'חי',
    kpi: {
      balance: 'יתרת חשבון · P&L', pnl: 'P&L נקי', pf: 'פרופיט פקטור', win: 'ווין רייט',
      expectancy: 'תוחלת עסקה', avgrr: 'יחס R ממוצע', streak: 'סטרייק', maxdd: 'Max Drawdown',
      longshort: 'לונג / שורט', bestday: 'היום הכי טוב', tradesday: 'עסקאות ליום', avgwl: 'ממוצע רווח/הפסד',
    },
    winW: 'W', winBE: 'BE', winL: 'L', streakDays: 'ימים', streakTrades: 'עסקאות',
    aiK: 'תובנת AI · יומית', aiConf: 'רמת ביטחון', aiSample: (n: number) => `מבוסס על ${n} עסקאות`,
    aiCta: 'לניתוח המלא →',
    aiWaitingT: 'ממתין ל־3 עסקאות ומעלה',
    aiWaitingBody: 'ברגע שתתעד 3 עסקאות ומעלה, המאמן ינתח את היומן שלך ויציג כאן את התובנה החזקה ביותר.',
    aiLockedEyebrow: 'נעול במסלול חינמי',
    aiLockedMsgPre: 'תובנות AI יומיות, מותאמות אישית — במסלול',
    aiLockedMsgBold: 'PRO ומעלה', aiLockedCta: 'שדרוג ל־PRO →',
    macroK: 'דוחות מאקרו · USD השפעה גבוהה', macroWeek: 'השבוע',
    macroToday: 'היום', macroEmpty: 'אין אירועים בעלי השפעה גבוהה השבוע', macroUnavailable: '…',
    macroNext: 'הבא',
    calTitle: (m: string) => `יומן מסחר · ${m}`,
    calMonthly: 'P&L חודשי',
    calDays: (n: number) => `${n} ימי מסחר`,
    calWeek: (n: number) => `שבוע ${n}`,
    calWeekTrades: (n: number) => `${n} עסקאות`,
    dowNames: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'],
    calWeekHead: 'שבוע',
    paletteHd: "הוסף ווידג׳ט",
    confirmTitle: 'להסיר את הווידג׳ט?',
    confirmMsg: (name: string) => `הווידג׳ט <b>${name}</b> יוסר מהלוח שלך. ניתן להוסיף אותו שוב מהפלטה בכל רגע.`,
    confirmNote: 'הפעולה משפיעה רק על התצוגה שלך — אין השפעה על נתוני המסחר.',
    confirmCancel: 'ביטול',
    confirmDelete: 'הסר',
  },
  en: {
    edit: '⊞ Customize', editOn: '✓ Save layout', brand: 'ONYX · CONTROL', settings: 'Settings',
    greetMorning: 'Good morning', greetAfternoon: 'Good afternoon', greetEvening: 'Good evening', greetNight: 'Good night',
    sessionActive: (n: string) => `${n} active`, noSession: 'No active session',
    clockLabel: 'ISRAEL TIME', tradesLabel: 'trades', importLast: 'last import',
    unitLabel: 'DISPLAY UNIT',
    liveTag: 'LIVE',
    kpi: {
      balance: 'ACCOUNT · P&L', pnl: 'NET P&L', pf: 'PROFIT FACTOR', win: 'WIN RATE',
      expectancy: 'EXPECTANCY', avgrr: 'AVG R', streak: 'STREAK', maxdd: 'MAX DRAWDOWN',
      longshort: 'LONG / SHORT', bestday: 'BEST DAY', tradesday: 'TRADES / DAY', avgwl: 'AVG WIN/LOSS',
    },
    winW: 'W', winBE: 'BE', winL: 'L', streakDays: 'days', streakTrades: 'trades',
    aiK: 'AI INSIGHT · DAILY', aiConf: 'CONFIDENCE', aiSample: (n: number) => `Based on ${n} trades`,
    aiCta: 'Full analysis →',
    aiWaitingT: 'Waiting for 3+ trades',
    aiWaitingBody: 'Once you log 3 or more trades, the coach will surface its strongest insight here.',
    aiLockedEyebrow: 'LOCKED ON FREE PLAN',
    aiLockedMsgPre: 'Daily, personalized AI insights — on',
    aiLockedMsgBold: 'PRO and above', aiLockedCta: 'Upgrade to PRO →',
    macroK: 'MACRO · USD HIGH-IMPACT', macroWeek: 'This week',
    macroToday: 'TODAY', macroEmpty: 'No high-impact events this week', macroUnavailable: '…',
    macroNext: 'NEXT',
    calTitle: (m: string) => `Trade journal · ${m}`,
    calMonthly: 'Monthly P&L',
    calDays: (n: number) => `${n} trading days`,
    calWeek: (n: number) => `Week ${n}`,
    calWeekTrades: (n: number) => `${n} trades`,
    dowNames: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    calWeekHead: 'WEEK',
    paletteHd: 'ADD WIDGET',
    confirmTitle: 'Remove this widget?',
    confirmMsg: (name: string) => `The <b>${name}</b> widget will be removed from your dashboard. You can add it back any time from the palette.`,
    confirmNote: "This only affects your view — trade data is untouched.",
    confirmCancel: 'Cancel',
    confirmDelete: 'Remove',
  },
} as const;

/* ══════════════════════════════════════════════════════════════════
   Helpers
══════════════════════════════════════════════════════════════════ */
const todayKey = () => new Date().toISOString().slice(0, 10);
const hhmmToMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? +m[1] * 60 + +m[2] : -1; };
const weekdayShort = (iso: string, locale: string) => new Date(iso + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short' });

/** Aggregate the tick and point values across the user's actual trades, so
 *  ticks/points conversion reflects what they actually trade, not a guess. */
function contractContext(trades: TradeEntry[]): { avgTickValue: number; avgPointValue: number } {
  if (!trades.length) {
    const es = INSTRUMENTS.ES;
    return { avgTickValue: es.tickValue, avgPointValue: pointValue('ES') };
  }
  let tickSum = 0, pointSum = 0, count = 0;
  for (const t of trades) {
    const spec = INSTRUMENTS[t.symbol];
    if (!spec) continue;
    tickSum += spec.tickValue * (t.contracts || 1);
    pointSum += pointValue(t.symbol) * (t.contracts || 1);
    count += (t.contracts || 1);
  }
  if (!count) {
    const es = INSTRUMENTS.ES;
    return { avgTickValue: es.tickValue, avgPointValue: pointValue('ES') };
  }
  return { avgTickValue: tickSum / count, avgPointValue: pointSum / count };
}

/** Format a signed dollar amount in the current display unit. */
function fmt(usd: number, unit: Unit, ctx: { accountStart: number; avgRisk: number; avgTickValue: number; avgPointValue: number }): string {
  const sign = usd >= 0 ? '+' : '-';
  const abs = Math.abs(usd);
  switch (unit) {
    case 'dollar':  return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
    case 'percent': return sign + (abs / ctx.accountStart * 100).toFixed(2) + '%';
    case 'r':       return sign + (ctx.avgRisk > 0 ? abs / ctx.avgRisk : 0).toFixed(2) + 'R';
    case 'ticks':   return sign + Math.round(abs / Math.max(0.01, ctx.avgTickValue)).toLocaleString('en-US') + ' tk';
    case 'points':  return sign + Math.round(abs / Math.max(0.01, ctx.avgPointValue)).toLocaleString('en-US') + ' pt';
  }
}

/** Format an absolute (non-signed) dollar amount — used for account balance. */
function fmtAbs(usd: number, unit: Unit, ctx: { accountStart: number; avgRisk: number; avgTickValue: number; avgPointValue: number }): string {
  if (unit === 'dollar')  return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: usd % 1 ? 2 : 0, maximumFractionDigits: 2 });
  if (unit === 'percent') return (usd / ctx.accountStart * 100).toFixed(1) + '%';
  return fmt(usd - ctx.accountStart, unit, ctx);
}

interface AggStats {
  pnl: number; decided: number; wins: number; losses: number; bes: number;
  wr: number | null; pf: number | null; expectancy: number | null; avgR: number | null;
  avgWin: number; avgLoss: number; maxDD: number; longPct: number | null; shortPct: number | null;
  winStreakDays: number; winStreakTrades: number; bestDayPnl: number; tradesPerDay: number | null;
}
function aggregate(trades: TradeEntry[]): AggStats {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins   = closed.filter(t => t.result === 'WIN');
  const losses = closed.filter(t => t.result === 'LOSS');
  const bes    = closed.filter(t => t.result === 'BE');
  const decided = wins.length + losses.length;
  const pnlOf = (t: TradeEntry): number => (t.pnlUsd ?? tradePnL(t) ?? 0);
  const rOf   = (t: TradeEntry): number => (t.tradeR ?? rMultiple(t) ?? 0);

  const winsPnl   = wins.reduce((s, t) => s + Math.abs(pnlOf(t)), 0);
  const lossesPnl = losses.reduce((s, t) => s + Math.abs(pnlOf(t)), 0);
  const pnl       = closed.reduce((s, t) => s + pnlOf(t), 0);

  // Equity curve → max drawdown in USD
  const sorted = [...closed].sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time));
  let peak = 0, running = 0, maxDD = 0;
  for (const t of sorted) { running += pnlOf(t); if (running > peak) peak = running; const dd = peak - running; if (dd > maxDD) maxDD = dd; }

  // Direction split
  const longs  = closed.filter(t => t.direction === 'LONG').length;
  const shorts = closed.filter(t => t.direction === 'SHORT').length;
  const dirTotal = longs + shorts;

  // Per-day aggregation for streaks & best day
  const dayMap = new Map<string, { pnl: number; n: number }>();
  for (const t of closed) {
    const d = dayMap.get(t.dateISO) ?? { pnl: 0, n: 0 };
    d.pnl += pnlOf(t); d.n += 1;
    dayMap.set(t.dateISO, d);
  }
  const days = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let streakDays = 0;
  for (let i = days.length - 1; i >= 0; i--) { if (days[i][1].pnl > 0) streakDays++; else break; }
  let streakTrades = 0;
  for (let i = sorted.length - 1; i >= 0; i--) { if (sorted[i].result === 'WIN') streakTrades++; else break; }
  const bestDayPnl = days.length ? Math.max(...days.map(d => d[1].pnl)) : 0;
  const tradesPerDay = days.length ? closed.length / days.length : null;

  return {
    pnl, decided, wins: wins.length, losses: losses.length, bes: bes.length,
    wr: decided ? (wins.length / decided) * 100 : null,
    pf: lossesPnl > 0 ? winsPnl / lossesPnl : (winsPnl > 0 ? Infinity : null),
    expectancy: closed.length ? pnl / closed.length : null,
    avgR: closed.length ? closed.reduce((s, t) => s + rOf(t), 0) / closed.length : null,
    avgWin:  wins.length   ? winsPnl / wins.length     : 0,
    avgLoss: losses.length ? lossesPnl / losses.length : 0,
    maxDD,
    longPct:  dirTotal ? (longs / dirTotal) * 100  : null,
    shortPct: dirTotal ? (shorts / dirTotal) * 100 : null,
    winStreakDays: streakDays, winStreakTrades: streakTrades, bestDayPnl,
    tradesPerDay,
  };
}

/* ══════════════════════════════════════════════════════════════════
   Component
══════════════════════════════════════════════════════════════════ */
export default function DashboardView() {
  const { lang } = useLanguage();
  const L = lang as Lang;
  const s = STR[L];
  const { role } = usePlan();
  const isFree = role === 'free';
  const { user, isLoaded: userLoaded } = useUser();
  const firstName = userLoaded ? user?.firstName : undefined;

  /* ── State ────────────────────────────────────────────────────── */
  const [trades, setTrades]     = useState<TradeEntry[]>([]);
  const [clockStr, setClockStr] = useState('00:00:00');
  const [unit, setUnit]         = useState<Unit>('dollar');
  const [widgets, setWidgets]   = useState<WidgetKey[]>(DEFAULT_WIDGETS);
  const [editMode, setEditMode] = useState(false);
  const [monthCursor, setMonthCursor] = useState<Date>(() => { const d = new Date(); d.setDate(1); return d; });
  const [macro, setMacro]       = useState<MacroEventLite[] | null>(null);
  const [macroToday, setMacroToday] = useState<string | null>(null);
  const [discovery, setDiscovery]   = useState<AiDiscovery | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<WidgetKey | null>(null);

  /* ── Clock ───────────────────────────────────────────────────── */
  useEffect(() => {
    const update = () => setClockStr(new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour12: false }));
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-lang', L);
    document.documentElement.dir = L === 'he' ? 'rtl' : 'ltr';
  }, [L]);

  /* ── Local hydrate + cloud reconcile ─────────────────────────── */
  useEffect(() => {
    // widgets + unit prefs
    try { const w = localStorage.getItem(WIDGETS_KEY); if (w) { const arr = JSON.parse(w); if (Array.isArray(arr) && arr.length) setWidgets(arr); } } catch {}
    try { const u = localStorage.getItem(UNIT_KEY) as Unit | null; if (u && ['dollar','percent','r','ticks','points'].includes(u)) setUnit(u); } catch {}
    // trades
    setTrades(loadTrades());
    initSyncListeners();
    hydrateTradesFromCloud().then(merged => { if (merged) setTrades(merged); }).catch(() => {});
  }, []);

  /* ── Persist widgets + unit ──────────────────────────────────── */
  useEffect(() => { try { localStorage.setItem(WIDGETS_KEY, JSON.stringify(widgets)); } catch {} }, [widgets]);
  useEffect(() => { try { localStorage.setItem(UNIT_KEY, unit); } catch {} }, [unit]);

  /* ── Macro fetch ─────────────────────────────────────────────── */
  useEffect(() => {
    fetch('/api/macro?scope=week')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { setMacro(Array.isArray(d?.events) ? d.events : []); setMacroToday(typeof d?.today === 'string' ? d.today : null); })
      .catch(() => setMacro([]));
  }, []);

  /* ── AI discovery (PRO+ only, min 3 trades) ──────────────────── */
  useEffect(() => {
    if (isFree || trades.length < 3) { setDiscovery(null); return; }
    const cacheKey = 'onyx_ai_discovery_' + todayKey();
    const cached = localStorage.getItem(cacheKey);
    if (cached) { try { setDiscovery(JSON.parse(cached)); return; } catch {} }
    fetch('/api/ai/discovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trades, lang: L }) })
      .then(r => r.json())
      .then(({ discovery: d }: { discovery: AiDiscovery | null }) => {
        if (!d) return;
        setDiscovery(d);
        try { localStorage.setItem(cacheKey, JSON.stringify(d)); } catch {}
      })
      .catch(() => {});
  }, [isFree, trades, L]);

  /* ── Derived: stats + calendar + conversion context ──────────── */
  const stats = useMemo(() => aggregate(trades), [trades]);
  const cctx = useMemo(() => contractContext(trades), [trades]);
  const avgRisk = useMemo(() => {
    // Average absolute R×contracts across ALL closed trades — the "1R" the user actually risks per trade.
    const closed = trades.filter(t => t.result !== 'OPEN' && (t.tradeR ?? rMultiple(t)) != null);
    if (!closed.length) return 100; // safe fallback
    const withPnl = closed.filter(t => (t.pnlUsd ?? tradePnL(t)) != null && (t.tradeR ?? rMultiple(t)));
    if (!withPnl.length) return 100;
    // For each trade, |pnl / R| gives its 1R in dollars. Average those.
    let sum = 0, n = 0;
    for (const t of withPnl) {
      const p = Math.abs(t.pnlUsd ?? tradePnL(t) ?? 0);
      const r = Math.abs(t.tradeR ?? rMultiple(t) ?? 0);
      if (r > 0) { sum += p / r; n++; }
    }
    return n > 0 ? sum / n : 100;
  }, [trades]);
  const fmtCtx = { accountStart: ACCOUNT_START_DEFAULT, avgRisk, ...cctx };

  const accountBalance = ACCOUNT_START_DEFAULT + stats.pnl;

  /* ── Calendar data ───────────────────────────────────────────── */
  const calendar = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDow = firstOfMonth.getDay(); // 0=Sun

    // Aggregate trades by day within this month
    const byDay = new Map<number, { pnl: number; n: number }>();
    for (const t of trades) {
      if (t.result === 'OPEN') continue;
      const d = new Date(t.dateISO + 'T12:00:00');
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const key = d.getDate();
      const cur = byDay.get(key) ?? { pnl: 0, n: 0 };
      cur.pnl += (t.pnlUsd ?? tradePnL(t) ?? 0);
      cur.n += 1;
      byDay.set(key, cur);
    }

    // Build rows of 7 slots + weekly summary
    const slots: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) slots.push(null);
    for (let d = 1; d <= daysInMonth; d++) slots.push(d);
    // Pad end
    while (slots.length % 7 !== 0) slots.push(null);

    const rows: { days: (number | null)[]; weekPnl: number; weekTrades: number; weekNum: number }[] = [];
    let weekNum = 0;
    for (let i = 0; i < slots.length; i += 7) {
      weekNum++;
      const days = slots.slice(i, i + 7);
      let weekPnl = 0, weekTrades = 0;
      for (const d of days) { if (d != null) { const info = byDay.get(d); if (info) { weekPnl += info.pnl; weekTrades += info.n; } } }
      rows.push({ days, weekPnl, weekTrades, weekNum });
    }

    const monthPnl = [...byDay.values()].reduce((s, d) => s + d.pnl, 0);
    const monthDays = byDay.size;
    const bestDay = [...byDay.values()].reduce((m, d) => Math.max(m, d.pnl), -Infinity);

    return { year, month, byDay, rows, monthPnl, monthDays, bestDay: bestDay === -Infinity ? 0 : bestDay };
  }, [trades, monthCursor]);

  const monthLabel = useMemo(() => {
    return monthCursor.toLocaleDateString(L === 'he' ? 'he-IL' : 'en-US', { month: 'long', year: 'numeric' });
  }, [monthCursor, L]);

  /* ── Sessions + greeting ─────────────────────────────────────── */
  const activeSessionIdx = getActiveSessionIdx();
  const idtHour = parseInt(clockStr.slice(0, 2), 10) || 0;
  const greetWord = idtHour < 5 || idtHour >= 22 ? s.greetNight
    : idtHour < 12 ? s.greetMorning
    : idtHour < 18 ? s.greetAfternoon
    : s.greetEvening;
  const greeting = firstName ? `${greetWord}, ${firstName}` : greetWord;
  const activeSess = activeSessionIdx >= 0 ? SESS[activeSessionIdx] : null;
  const dateStr = new Date().toLocaleDateString(L === 'he' ? 'he-IL' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  /* ── Macro derived ───────────────────────────────────────────── */
  const nowMin = hhmmToMin(clockStr);
  const primaryMacro = (macro ?? [])
    .filter(e => e.impact === 'High' && e.currency === 'USD')
    .sort((a, b) => (a.dateIsrael + a.timeIsrael).localeCompare(b.dateIsrael + b.timeIsrael));
  const nextMacro = primaryMacro
    .find(e => e.dateIsrael > (macroToday ?? '') || (e.dateIsrael === macroToday && e.timeIsrael !== '' && hhmmToMin(e.timeIsrael) > nowMin));

  /* ── Handlers ────────────────────────────────────────────────── */
  const toggleEdit = () => setEditMode(v => !v);
  const askRemoveWidget = useCallback((id: WidgetKey) => setConfirmRemove(id), []);
  const confirmRemoveWidget = useCallback(() => {
    if (confirmRemove) setWidgets(w => w.filter(x => x !== confirmRemove));
    setConfirmRemove(null);
  }, [confirmRemove]);
  const cancelRemoveWidget = useCallback(() => setConfirmRemove(null), []);
  const addWidget = useCallback((id: WidgetKey) => setWidgets(w => (w.includes(id) ? w : [...w, id])), []);
  const prevMonth = () => setMonthCursor(m => { const d = new Date(m); d.setMonth(d.getMonth() - 1); return d; });
  const nextMonth = () => setMonthCursor(m => { const d = new Date(m); d.setMonth(d.getMonth() + 1); return d; });

  /* ── Widget metadata ─────────────────────────────────────────── */
  const ALL_WIDGETS: { id: WidgetKey; label: string }[] = [
    { id: 'balance',   label: s.kpi.balance },
    { id: 'pnl',       label: s.kpi.pnl },
    { id: 'pf',        label: s.kpi.pf },
    { id: 'win',       label: s.kpi.win },
    { id: 'expectancy',label: s.kpi.expectancy },
    { id: 'avgrr',     label: s.kpi.avgrr },
    { id: 'streak',    label: s.kpi.streak },
    { id: 'maxdd',     label: s.kpi.maxdd },
    { id: 'longshort', label: s.kpi.longshort },
    { id: 'bestday',   label: s.kpi.bestday },
    { id: 'tradesday', label: s.kpi.tradesday },
    { id: 'avgwl',     label: s.kpi.avgwl },
  ];

  /* ── Render helpers ──────────────────────────────────────────── */
  const RemoveBtn = ({ id }: { id: WidgetKey }) => (
    <span className="dp-widget-remove" onClick={(e) => { e.stopPropagation(); askRemoveWidget(id); }} title={L === 'he' ? 'הסר ווידג׳ט' : 'Remove widget'}>×</span>
  );

  const renderWidget = (id: WidgetKey) => {
    switch (id) {
      case 'balance': {
        // Balance is span-2 with equity curve
        const points = (() => {
          // Cumulative PnL curve — last 30 closed trades (or fewer)
          const closed = trades.filter(t => t.result !== 'OPEN').sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time)).slice(-30);
          if (!closed.length) return 'M0,20 L400,20';
          let cum = 0;
          const cums = closed.map(t => (cum += (t.pnlUsd ?? tradePnL(t) ?? 0)));
          const min = Math.min(0, ...cums), max = Math.max(0, ...cums);
          const range = Math.max(1, max - min);
          const w = 400, h = 40;
          const stepX = closed.length > 1 ? w / (closed.length - 1) : 0;
          const parts = cums.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${(h - 2 - ((v - min) / range) * (h - 6)).toFixed(1)}`);
          return parts.join(' ');
        })();
        const pnlAbs = accountBalance;
        return (
          <div key={id} className="dp-widget dp-kpi-balance" data-w={id}>
            {editMode && <RemoveBtn id={id} />}
            <div className="dp-widget-k">{s.kpi.balance}</div>
            <div className="dp-kpi-val">{fmtAbs(pnlAbs, unit, fmtCtx)}</div>
            <div className="dp-widget-sub"><span style={{ color: stats.pnl >= 0 ? 'var(--dp-bull)' : 'var(--dp-bear)' }}>{fmt(stats.pnl, unit, fmtCtx)}</span></div>
            <svg className="dp-kpi-spark" viewBox="0 0 400 40" preserveAspectRatio="none">
              <defs><linearGradient id="dp-eq-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e6c665" stopOpacity=".4" /><stop offset="1" stopColor="#e6c665" stopOpacity="0" /></linearGradient></defs>
              <path d={`${points} L400,40 L0,40 Z`} fill="url(#dp-eq-grad)" />
              <path d={points} fill="none" stroke="#e6c665" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        );
      }
      case 'pnl': return (
        <div key={id} className="dp-widget" data-w={id}>{editMode && <RemoveBtn id={id} />}
          <div className="dp-widget-k">{s.kpi.pnl}</div>
          <div className={`dp-widget-v ${stats.pnl >= 0 ? 'bull' : 'bear'}`}>{fmt(stats.pnl, unit, fmtCtx)}</div>
        </div>);
      case 'pf': return (
        <div key={id} className="dp-widget" data-w={id}>{editMode && <RemoveBtn id={id} />}
          <div className="dp-widget-k">{s.kpi.pf}</div>
          <div className="dp-widget-v gold">{stats.pf == null ? '—' : (stats.pf === Infinity ? '∞' : stats.pf.toFixed(2))}</div>
        </div>);
      case 'win': {
        const wr = stats.wr ?? 0;
        const wPct = stats.decided ? (stats.wins / stats.decided) * 100 : 0;
        const bePct = stats.decided ? (stats.bes / (stats.wins + stats.losses + stats.bes || 1)) * 100 : 0;
        return (
          <div key={id} className="dp-widget" data-w={id}>{editMode && <RemoveBtn id={id} />}
            <div className="dp-widget-k">{s.kpi.win}</div>
            <div className="dp-gauge">
              <div className="dp-gauge-ring" style={{ background: `conic-gradient(var(--dp-bull) 0 ${wPct}%, var(--dp-w10) ${wPct}% ${wPct + bePct}%, var(--dp-bear) ${wPct + bePct}% 100%)` }} />
              <div className="dp-gauge-legend">
                <span style={{ color: 'var(--dp-bull)' }}>{stats.wins} {s.winW}</span>
                <span>{stats.bes} {s.winBE}</span>
                <span style={{ color: 'var(--dp-bear)' }}>{stats.losses} {s.winL}</span>
              </div>
              <div className="dp-widget-v" style={{ fontSize: 17, marginInlineStart: 'auto' }}>{stats.wr == null ? '—' : Math.round(wr) + '%'}</div>
            </div>
          </div>
        );
      }
      case 'expectancy': return (
        <div key={id} className="dp-widget" data-w={id}>{editMode && <RemoveBtn id={id} />}
          <div className="dp-widget-k">{s.kpi.expectancy}</div>
          <div className="dp-widget-v gold">{stats.expectancy == null ? '—' : fmt(stats.expectancy, unit, fmtCtx).replace(/^\+/, '')}</div>
        </div>);
      case 'avgrr': return (
        <div key={id} className="dp-widget" data-w={id}>{editMode && <RemoveBtn id={id} />}
          <div className="dp-widget-k">{s.kpi.avgrr}</div>
          <div className="dp-widget-v gold">{stats.avgR == null ? '—' : (stats.avgR >= 0 ? '+' : '') + stats.avgR.toFixed(2) + 'R'}</div>
        </div>);
      case 'streak': return (
        <div key={id} className="dp-widget" data-w={id}>{editMode && <RemoveBtn id={id} />}
          <div className="dp-widget-k">{s.kpi.streak}</div>
          <div className="dp-streak-row">
            <div className="dp-streak-cell"><div className="dp-widget-v" style={{ fontSize: 18 }}>{stats.winStreakDays}</div><div className="dp-widget-sub">{s.streakDays}</div></div>
            <div className="dp-streak-cell"><div className="dp-widget-v" style={{ fontSize: 18 }}>{stats.winStreakTrades}</div><div className="dp-widget-sub">{s.streakTrades}</div></div>
          </div>
        </div>);
      case 'maxdd': return (
        <div key={id} className="dp-widget" data-w={id}>{editMode && <RemoveBtn id={id} />}
          <div className="dp-widget-k">{s.kpi.maxdd}</div>
          <div className="dp-widget-v bear">{stats.maxDD > 0 ? fmt(-stats.maxDD, unit, fmtCtx) : '—'}</div>
        </div>);
      case 'longshort': return (
        <div key={id} className="dp-widget" data-w={id}>{editMode && <RemoveBtn id={id} />}
          <div className="dp-widget-k">{s.kpi.longshort}</div>
          <div className="dp-widget-v" style={{ fontSize: 19 }}>
            <span className="bull" style={{ color: 'var(--dp-bull)' }}>{stats.longPct == null ? '—' : Math.round(stats.longPct) + '%'}</span>
            <span style={{ color: 'var(--dp-w28)' }}> / </span>
            <span className="bear" style={{ color: 'var(--dp-bear)' }}>{stats.shortPct == null ? '—' : Math.round(stats.shortPct) + '%'}</span>
          </div>
        </div>);
      case 'bestday': return (
        <div key={id} className="dp-widget" data-w={id}>{editMode && <RemoveBtn id={id} />}
          <div className="dp-widget-k">{s.kpi.bestday}</div>
          <div className={`dp-widget-v ${stats.bestDayPnl >= 0 ? 'bull' : 'bear'}`}>{stats.bestDayPnl === 0 ? '—' : fmt(stats.bestDayPnl, unit, fmtCtx)}</div>
        </div>);
      case 'tradesday': return (
        <div key={id} className="dp-widget" data-w={id}>{editMode && <RemoveBtn id={id} />}
          <div className="dp-widget-k">{s.kpi.tradesday}</div>
          <div className="dp-widget-v gold">{stats.tradesPerDay == null ? '—' : stats.tradesPerDay.toFixed(1)}</div>
        </div>);
      case 'avgwl': return (
        <div key={id} className="dp-widget" data-w={id}>{editMode && <RemoveBtn id={id} />}
          <div className="dp-widget-k">{s.kpi.avgwl}</div>
          <div className="dp-widget-v" style={{ fontSize: 15 }}>
            <span style={{ color: 'var(--dp-bull)' }}>{fmt(stats.avgWin, unit, fmtCtx)}</span>
            <span style={{ color: 'var(--dp-w28)' }}> / </span>
            <span style={{ color: 'var(--dp-bear)' }}>{fmt(-stats.avgLoss, unit, fmtCtx)}</span>
          </div>
        </div>);
    }
  };

  /* ── Widget hover — spotlight follow-mouse effect ────────────── */
  const onGridMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const w = (e.target as HTMLElement).closest('.dp-widget') as HTMLElement | null;
    if (!w) return;
    const r = w.getBoundingClientRect();
    w.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    w.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, []);

  /* ══════════════════════════════════════════════════════════════
     Render
  ══════════════════════════════════════════════════════════════ */
  return (
    <div className={`dp-app${editMode ? ' editing' : ''}`}>
      {/* Row 1 — bar */}
      <div className="dp-bar">
        <div className="dp-bar-left">
          <button className={`dp-btn-edit${editMode ? ' on' : ''}`} onClick={toggleEdit}>{editMode ? s.editOn : s.edit}</button>
          <span className={`dp-plan-badge${isFree ? ' free' : ''}`}>{role.toUpperCase()}</span>
        </div>
        <div className="dp-bar-right">
          <span className="dp-brand">{s.brand}</span>
          <span className="dp-brand-dot" />
          <Link href="/dashboard/rules" className="dp-icon-btn" title={s.settings}>⚙</Link>
        </div>
      </div>

      {/* Row 2 — greeting + clock */}
      <div className="dp-greet-row dp-rise">
        <div>
          <h1 className="dp-greet">{greeting}. {activeSess && <small>{s.sessionActive(L === 'he' ? activeSess.he : activeSess.en)}</small>}</h1>
          <div className="dp-greet-sub" dir={L === 'he' ? 'rtl' : 'ltr'}>{dateStr} · {trades.length} {s.tradesLabel}</div>
        </div>
        <div className="dp-clock"><span className="dp-clock-k">{s.clockLabel}</span><span className="dp-clock-v dp-num">{clockStr}</span></div>
      </div>

      {/* Row 3 — sessions + unit toggle */}
      <div className="dp-control-row">
        <div className="dp-sessions">
          {SESS.map((sess, i) => (
            <div key={sess.key} className={`dp-session-chip${i === activeSessionIdx ? ' active' : ''}`}>
              <span className="dp-session-dot" />
              <span className="dp-session-name">{L === 'he' ? sess.he : sess.en}</span>
              {i === activeSessionIdx && <span className="dp-session-live">{s.liveTag}</span>}
            </div>
          ))}
        </div>
        <div className="dp-unit-wrap">
          <span className="dp-unit-label">{s.unitLabel}</span>
          <div className="dp-unit-toggle">
            {(['dollar','percent','r','ticks','points'] as Unit[]).map(u => (
              <button key={u} className={unit === u ? 'active' : ''} onClick={() => setUnit(u)}>
                {u === 'dollar' ? '$' : u === 'percent' ? '%' : u === 'r' ? 'R' : u === 'ticks' ? 'Ticks' : 'Points'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="dp-kpis dp-rise" onMouseMove={onGridMove}>
        {widgets.map(id => renderWidget(id))}
      </div>

      {/* Body — side (AI + macro) + calendar */}
      <div className="dp-body">
        {/* Side: AI + Macro */}
        <div className="dp-col dp-side dp-rise">
          {isFree ? (
            <div className="dp-ai-locked">
              <div className="dp-ai-locked-eyebrow">{s.aiLockedEyebrow}</div>
              <div className="dp-ai-locked-msg">{s.aiLockedMsgPre} <b>{s.aiLockedMsgBold}</b></div>
              <Link href="/checkout" className="dp-ai-locked-cta">{s.aiLockedCta}</Link>
            </div>
          ) : (
            <div className="dp-ai">
              <div className="dp-ai-head"><div className="dp-ai-ico">◆</div><div className="dp-ai-k">{s.aiK}</div></div>
              {discovery ? (
                <>
                  <div className="dp-ai-txt" dangerouslySetInnerHTML={{ __html: discovery.evidence.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') }} />
                  <div className="dp-ai-foot">
                    <span className="dp-ai-conf">✓ {s.aiConf} · {discovery.confidenceLevel}</span>
                    <span className="dp-ai-note">{s.aiSample(discovery.sampleSize)}</span>
                    <Link href="/dashboard/coach" className="dp-ai-cta">{s.aiCta}</Link>
                  </div>
                </>
              ) : (
                <>
                  <div className="dp-ai-txt">{s.aiWaitingBody}</div>
                  <div className="dp-ai-foot">
                    <Link href="/dashboard/journal" className="dp-ai-cta">{s.aiWaitingT}</Link>
                  </div>
                </>
              )}
            </div>
          )}
          <div className="dp-panel dp-macro">
            <div className="dp-macro-hd">
              <span className="dp-macro-k">{s.macroK}</span>
              <span className="dp-macro-note">{s.macroWeek}</span>
            </div>
            <div className="dp-macro-list">
              {macro == null ? (
                <span className="dp-macro-empty">{s.macroUnavailable}</span>
              ) : primaryMacro.length === 0 ? (
                <span className="dp-macro-empty">{s.macroEmpty}</span>
              ) : (
                primaryMacro.slice(0, 8).map((e, i) => {
                  const isNext = !!nextMacro && e.dateIsrael === nextMacro.dateIsrael && e.title === nextMacro.title && e.timeIsrael === nextMacro.timeIsrael;
                  const dayLabel = e.dateIsrael === macroToday ? s.macroToday : weekdayShort(e.dateIsrael, L === 'he' ? 'he-IL' : 'en-US');
                  return (
                    <div key={`${e.dateIsrael}-${e.title}-${i}`} className={`dp-macro-row${isNext ? ' next' : ''}`}>
                      <span className="dp-macro-impact" aria-hidden />
                      <span className="dp-macro-day">{dayLabel}</span>
                      <span className="dp-macro-time dp-num">{e.timeIsrael || '—'}</span>
                      <span className="dp-macro-title">{e.title}</span>
                      {isNext && <span className="dp-macro-next">{s.macroNext}</span>}
                      <span className="dp-macro-cur">{e.currency}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Calendar */}
        <div className="dp-col dp-main-cal dp-rise">
          <div className="dp-panel dp-cal">
            <div className="dp-cal-hd">
              <div className="dp-cal-month">{s.calTitle(monthLabel)}</div>
              <div className="dp-cal-hd-right">
                <span className="dp-cal-monthly">{s.calMonthly} · <b className={calendar.monthPnl >= 0 ? 'win' : 'loss'}>{calendar.monthDays === 0 ? '—' : fmt(calendar.monthPnl, unit, fmtCtx)}</b></span>
                <span className="dp-cal-monthly">{s.calDays(calendar.monthDays)}</span>
                <div className="dp-cal-nav"><button onClick={prevMonth}>‹</button><button onClick={nextMonth}>›</button></div>
              </div>
            </div>
            <div className="dp-cal-dows">
              {s.dowNames.map((n, i) => <div key={i} className="dp-cal-dow">{n}</div>)}
              <div className="dp-cal-dow wk">{s.calWeekHead}</div>
            </div>
            <div className="dp-cal-grid">
              {calendar.rows.flatMap(row => [
                ...row.days.map((d, i) => {
                  if (d === null) return <div key={`e${row.weekNum}-${i}`} className="dp-cal-cell empty" />;
                  const info = calendar.byDay.get(d);
                  if (!info) return <div key={`d${row.weekNum}-${i}`} className="dp-cal-cell"><div className="dp-cal-daynum">{d}</div></div>;
                  const cls = info.pnl >= 0 ? 'win' : 'loss';
                  const isBest = info.pnl === calendar.bestDay && info.pnl > 0;
                  return (
                    <div key={`d${row.weekNum}-${i}`} className={`dp-cal-cell ${cls}${isBest ? ' best' : ''}`}>
                      <div className="dp-cal-daynum">{d}</div>
                      <div>
                        <div className={`dp-cal-pnl ${cls}`}>{fmt(info.pnl, unit, fmtCtx)}</div>
                        <div className="dp-cal-trades">{info.n}t</div>
                      </div>
                    </div>
                  );
                }),
                (() => {
                  const vcls = row.weekTrades === 0 ? 'flat' : row.weekPnl >= 0 ? 'win' : 'loss';
                  const pnlStr = row.weekTrades === 0 ? '—' : fmt(row.weekPnl, unit, fmtCtx);
                  return (
                    <div key={`w${row.weekNum}`} className="dp-week-cell">
                      <div className="dp-week-cell-k">{s.calWeek(row.weekNum)}</div>
                      <div className={`dp-week-cell-v ${vcls}`}>{pnlStr}</div>
                      {row.weekTrades > 0 && <div className="dp-week-cell-d">{s.calWeekTrades(row.weekTrades)}</div>}
                    </div>
                  );
                })(),
              ])}
            </div>
          </div>
        </div>
      </div>

      {/* Floating palette (edit mode) */}
      <div className="dp-palette">
        <div className="dp-palette-hd">{s.paletteHd}</div>
        <div className="dp-palette-grid">
          {ALL_WIDGETS.map(({ id, label }) => {
            const added = widgets.includes(id);
            return (
              <span key={id} className={`dp-chip${added ? ' added' : ''}`} onClick={() => addWidget(id)}>
                <span className="plus">{added ? '✓' : '+'}</span>{label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Confirm removal dialog */}
      <div className={`dp-confirm-overlay${confirmRemove ? ' on' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) cancelRemoveWidget(); }}>
        <div className="dp-confirm" role="alertdialog" aria-modal="true">
          <div className="dp-confirm-head">
            <div className="dp-confirm-icon">⚠</div>
            <div className="dp-confirm-title">{s.confirmTitle}</div>
          </div>
          <div className="dp-confirm-body">
            <div className="dp-confirm-msg" dangerouslySetInnerHTML={{ __html: s.confirmMsg(confirmRemove ? (ALL_WIDGETS.find(w => w.id === confirmRemove)?.label ?? confirmRemove) : '') }} />
            <div className="dp-confirm-note">{s.confirmNote}</div>
          </div>
          <div className="dp-confirm-foot">
            <button className="dp-confirm-btn ghost" onClick={cancelRemoveWidget}>{s.confirmCancel}</button>
            <button className="dp-confirm-btn danger" onClick={confirmRemoveWidget}>{s.confirmDelete}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

