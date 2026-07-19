'use client';

import './dp.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { useLanguage } from '../hooks/useLanguage';
import { usePlan } from './PlanProvider';
import { loadTrades, hydrateTradesFromCloud } from '../lib/journal';
import type { TradeEntry } from '../lib/journal';
import { hydrateDashboard, pushDashboard, initSyncListeners } from '../lib/sync/collections';
import { SESS, getActiveSessionIdx } from '../lib/sessions';
import { computeRuleStats } from '../lib/rules/stats';
import type { Rule, RuleCheck } from '../lib/rules/types';
import TypingDots from './TypingDots';
import Tooltip from './Tooltip';
import InsightText from './InsightText';

/* ── Constants ──────────────────────────────────────────────────── */
const SPEC = {
  ES: { std: 'ES', micro: 'MES', ptStd: 50, ptMicro: 5, tag: 'S&P' },
  NQ: { std: 'NQ', micro: 'MNQ', ptStd: 20, ptMicro: 2, tag: 'NDX' },
} as const;
type AssetKey = keyof typeof SPEC;
const RISK_PRESETS = [0.25, 0.5, 1, 2] as const;

type ConfidenceLevel = 'low' | 'medium' | 'high';
/** Mirrors app/lib/intelligence/service.ts's AiDiscovery — kept as a local type
    (not imported) so this client component never pulls in server-only modules. */
interface AiDiscovery {
  title: string;
  evidence: string;
  action: string;
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
}
/** Mirrors lib/ai/macroCalendar's MacroEvent — local for the same reason. */
interface MacroEventLite {
  title: string;
  currency: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  dateIsrael: string;
  timeIsrael: string;
}

const CONF_META: Record<ConfidenceLevel, { fg: string; bg: string; bd: string; icon: string }> = {
  high:   { fg: 'var(--bull)', bg: 'rgba(111,165,128,.1)',  bd: 'rgba(111,165,128,.32)', icon: '✓' },
  medium: { fg: 'var(--gold)', bg: 'var(--gold-08)',        bd: 'var(--gold-20)',        icon: '~' },
  low:    { fg: 'var(--w55)',  bg: 'rgba(255,255,255,.04)', bd: 'rgba(255,255,255,.08)', icon: '!' },
};

const STR = {
  he: {
    nav: 'סקירה', idt: 'שעון ישראל', noSession: 'אין סשן פעיל', liveTag: 'שוק חי',
    briefingK: 'התדריך היומי',
    zonePerf: 'ביצועים', zoneDecision: 'מרכז ההחלטות', zoneTools: 'כלים',

    // Hero + daily state
    greetMorning: 'בוקר טוב', greetAfternoon: 'צהריים טובים', greetEvening: 'ערב טוב', greetNight: 'לילה טוב',
    sessionActive: (name: string) => `${name} פעילה כעת`,
    dailyStateK: 'מצב יומי', tradesLabel: 'עסקאות',
    stateOnTrack: 'בתוכנית', stateAttention: 'לתשומת לב', stateNoPlan: 'אין תוכנית',
    stateSubOnTrack: 'בתוך התוכנית שהגדרת להיום',
    stateSubCap: 'הגעת למקסימום העסקאות שהגדרת',
    stateSubViolated: (n: number) => `${n} חוקים הופרו היום`,
    stateSubNoPlan: 'לא הוגדרה תוכנית להיום — הגדר אחת למטה',
    sectionPlanK: 'תוכנית ומשימות', sectionToolsK: 'כלים ומאקרו',

    // AI hero
    aiHeroK: '◈ תובנת ה-AI של היום',
    aiHeroSub: 'הדבר החשוב ביותר שכדאי לך לדעת היום',
    aiEvidenceK: 'ראיות', aiConfidenceK: 'רמת ביטחון', aiActionK: 'פעולה',
    aiSample: (n: number) => `מבוסס על ${n} עסקאות`,
    aiWaiting: 'ממתין לעסקאות הראשונות',
    aiWaitingText: 'ברגע שתתעד 3 עסקאות ומעלה, המאמן ינתח את היומן שלך ויציג כאן את התובנה החזקה ביותר — מתי אתה מרוויח, היכן אתה מפסיד, ומה כדאי לשפר.',
    aiThinking: 'מנתח את היומן שלך',
    aiOpenCoach: 'פתח את המאמן',
    aiDisc: 'התובנות מבוססות על היומן האישי שלך ואינן ייעוץ או המלצת מסחר.',
    aiLockedEyebrow: 'נעול במסלול חינמי',
    aiLockedMsgPre: 'תובנות AI יומיות, מותאמות אישית — במסלול',
    aiLockedMsgBold: 'PRO ומעלה',
    aiLockedCta: 'שדרוג ל-PRO',
    aiLockedSampleK: 'תובנת AI · יומית (לדוגמה)',
    aiLockedSampleText: '3 מתוך 4 העסקאות המפסידות שלך החודש נפתחו מחוץ לחלון הסשן שהגדרת בתוכנית.',

    // Performance
    pnlToday: 'P&L היום', pnlWeek: 'P&L השבוע', pnlMonth: 'P&L החודש',
    winRate: 'אחוז הצלחה', profitFactor: 'פרופיט פקטור', avgR: 'R ממוצע',
    vsLastWeek: 'מול שבוע שעבר', vsLastMonth: 'מול חודש שעבר',
    noPrevWeek: 'אין שבוע קודם להשוואה', noPrevMonth: 'אין חודש קודם להשוואה',
    basedOn: (n: number) => `מבוסס על ${n} עסקאות מוכרעות`,
    noData: 'אין עדיין נתונים',
    pts: 'נק׳',

    // Mission control
    missionK: 'מרכז השליטה · תוכנית היום',
    mBias: 'הביאס של היום', mMax: 'מקסימום עסקאות', mRisk: 'סיכון לעסקה',
    mObjective: 'המטרה של היום', mObjectivePh: 'מה תרצה להשיג היום?',
    mSetups: 'סטאפים מותרים', mSetupsEmpty: 'לא הוגדרו סטאפים בפלייבוק',
    mNote: 'הערת סשן', mNotePh: 'כתוב תזכורת — תישמר במשימות',
    biasBull: 'עולה', biasBear: 'יורד', biasNeutral: 'ניטרלי',
    save: 'שמור תוכנית', savedOk: 'נשמר', dirty: 'שינויים שלא נשמרו',

    // Macro
    macroK: 'אירועי מאקרו השבוע', macroEmpty: 'אין אירועים בעלי השפעה גבוהה השבוע',
    macroUnavailable: 'לא ניתן לטעון את היומן הכלכלי כרגע', macroNext: 'הבא', macroToday: 'היום',
    perfTrendK: '10 הימים האחרונים',

    // Tools
    quickK: 'פעולות מהירות',
    ctaNewTrade: 'תיעוד עסקה חדשה', ctaJournal: 'פתח יומן', ctaCoach: 'שאל את המאמן',
    calcK: 'מחשבון סיכון', asset: 'נכס', balance: 'הון', risk: 'סיכון',
    stop: 'סטופ · נק׳', cashRisk: 'בסיכון', standard: 'סטנדרט', micro: 'מיקרו',
    calcShow: 'הצג', calcHide: 'הסתר',
    tasksK: 'משימות פתוחות',
    defaultReminders: ['ללא עסקאות לפני פתיחת לונדון', 'מקסימום 2 עסקאות ביום', 'עצור את המסחר אחרי יום של 2R הפסד', 'צלם מסך לכל כניסה'],
  },
  en: {
    nav: 'Overview', idt: 'ISRAEL TIME', noSession: 'NO ACTIVE SESSION', liveTag: 'MARKET LIVE',
    briefingK: 'DAILY BRIEFING',
    zonePerf: 'PERFORMANCE', zoneDecision: 'DECISION CENTER', zoneTools: 'TOOLS',

    greetMorning: 'Good morning', greetAfternoon: 'Good afternoon', greetEvening: 'Good evening', greetNight: 'Good night',
    sessionActive: (name: string) => `${name} active now`,
    dailyStateK: 'DAILY STATE', tradesLabel: 'trades',
    stateOnTrack: 'ON TRACK', stateAttention: 'ATTENTION', stateNoPlan: 'NO PLAN',
    stateSubOnTrack: "Within today's plan",
    stateSubCap: "You've hit your max trades for today",
    stateSubViolated: (n: number) => `${n} rules broken today`,
    stateSubNoPlan: 'No plan set for today — set one below',
    sectionPlanK: 'PLAN & TASKS', sectionToolsK: 'TOOLS & MACRO',

    aiHeroK: '◈ AI INSIGHT OF THE DAY',
    aiHeroSub: 'The most important thing to know today',
    aiEvidenceK: 'EVIDENCE', aiConfidenceK: 'CONFIDENCE', aiActionK: 'ACTION',
    aiSample: (n: number) => `Based on ${n} trades`,
    aiWaiting: 'Waiting for first trades',
    aiWaitingText: 'Once you log 3 or more trades, the coach will analyze your journal and surface its strongest insight here — when you profit, where you lose, and what is worth improving.',
    aiThinking: 'Analyzing your journal',
    aiOpenCoach: 'Open the coach',
    aiDisc: 'Insights are based on your own journal and are not financial or trading advice.',
    aiLockedEyebrow: 'LOCKED ON FREE PLAN',
    aiLockedMsgPre: 'Daily, personalized AI insights — on',
    aiLockedMsgBold: 'PRO and above',
    aiLockedCta: 'Upgrade to PRO',
    aiLockedSampleK: 'AI INSIGHT · DAILY (SAMPLE)',
    aiLockedSampleText: '3 of your 4 losing trades this month opened outside your defined session window.',

    pnlToday: "TODAY'S P&L", pnlWeek: "THIS WEEK'S P&L", pnlMonth: "THIS MONTH'S P&L",
    winRate: 'WIN RATE', profitFactor: 'PROFIT FACTOR', avgR: 'AVG R',
    vsLastWeek: 'vs last week', vsLastMonth: 'vs last month',
    noPrevWeek: 'No previous week to compare', noPrevMonth: 'No previous month to compare',
    basedOn: (n: number) => `Based on ${n} decided trades`,
    noData: 'No data yet',
    pts: 'pts',

    missionK: "MISSION CONTROL · TODAY'S PLAN",
    mBias: "TODAY'S BIAS", mMax: 'MAX TRADES', mRisk: 'RISK / TRADE',
    mObjective: "TODAY'S OBJECTIVE", mObjectivePh: 'What do you want to achieve today?',
    mSetups: 'ALLOWED SETUPS', mSetupsEmpty: 'No setups defined in the playbook',
    mNote: 'SESSION NOTE', mNotePh: 'Write a reminder — saved to tasks',
    biasBull: 'BULLISH', biasBear: 'BEARISH', biasNeutral: 'NEUTRAL',
    save: 'Save plan', savedOk: 'Saved', dirty: 'Unsaved changes',

    macroK: 'MACRO EVENTS THIS WEEK', macroEmpty: 'No high-impact events this week',
    macroUnavailable: 'Economic calendar unavailable right now', macroNext: 'NEXT', macroToday: 'TODAY',
    perfTrendK: 'LAST 10 DAYS',

    quickK: 'QUICK ACTIONS',
    ctaNewTrade: 'Log New Trade', ctaJournal: 'Open Journal', ctaCoach: 'Ask the coach',
    calcK: 'RISK CALCULATOR', asset: 'ASSET', balance: 'BALANCE', risk: 'RISK',
    stop: 'STOP · PTS', cashRisk: 'AT RISK', standard: 'STANDARD', micro: 'MICRO',
    calcShow: 'Show', calcHide: 'Hide',
    tasksK: 'OPEN TASKS',
    defaultReminders: ['No trades before London open', 'Max 2 trades per day', 'Stop trading after a -2R day', 'Screenshot every entry'],
  },
} as const;

/* ── Types ──────────────────────────────────────────────────────── */
interface Reminder { id: string; text: string; done: boolean; }
type Lang = 'he' | 'en';
interface PlanSaved { goal: string; bias: string; maxTrades: string; note: string; setups: string[] }

/* ── Helpers ────────────────────────────────────────────────────── */
const todayKey = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? n : 0; };
const money = (n: number) => (n >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const localISO = (d: Date) => d.toLocaleDateString('en-CA');
const hhmmToMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? +m[1] * 60 + +m[2] : -1; };
/** Short weekday label for a 'YYYY-MM-DD' Israel date — noon avoids any TZ/DST rollover onto the adjacent day. */
const weekdayShort = (iso: string, locale: string) => new Date(iso + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short' });

interface RangeStats { n: number; wins: number; losses: number; decided: number; pnl: number; avgR: number | null; wr: number | null; pf: number | null }
function rangeStats(list: TradeEntry[]): RangeStats {
  const closed = list.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result === 'WIN').length;
  const losses = closed.filter(t => t.result === 'LOSS').length;
  const decided = wins + losses;
  const pnl = closed.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
  const totalR = closed.reduce((s, t) => s + (t.tradeR ?? 0), 0);
  const sumWinR = closed.filter(t => t.result === 'WIN').reduce((s, t) => s + Math.abs(t.tradeR ?? 0), 0);
  const sumLossR = closed.filter(t => t.result === 'LOSS').reduce((s, t) => s + Math.abs(t.tradeR ?? 0), 0);
  return {
    n: closed.length, wins, losses, decided, pnl,
    avgR: closed.length ? totalR / closed.length : null,
    wr: decided ? (wins / decided) * 100 : null,
    pf: sumLossR > 0 ? sumWinR / sumLossR : null,
  };
}
/** % change vs a previous period — null when there's nothing honest to compare. */
const pctDelta = (cur: number, prev: number): number | null => (prev === 0 || !Number.isFinite(prev) ? null : ((cur - prev) / Math.abs(prev)) * 100);
const arrow = (n: number) => (n >= 0 ? '↑' : '↓');

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
  const [asset,     setAsset]     = useState<AssetKey>('ES');
  const [balance,   setBalance]   = useState('50000');
  const [risk,      setRisk]      = useState('1');
  const [stop,      setStop]      = useState('10');
  const [calcOpen,  setCalcOpen]  = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [goal,      setGoal]      = useState('');
  const [bias,      setBias]      = useState<'' | 'bull' | 'neutral' | 'bear'>('');
  const [maxTrades, setMaxTrades] = useState(2);
  const [allowedSetups, setAllowedSetups] = useState<string[]>([]);
  const [note,      setNote]      = useState('');
  const [saved,     setSaved]     = useState<PlanSaved>({ goal: '', bias: '', maxTrades: '2', note: '', setups: [] });
  const [justSaved, setJustSaved] = useState(false);
  const [clockStr,  setClockStr]  = useState('00:00:00');
  const [trades,    setTrades]    = useState<TradeEntry[]>([]);
  const [discovery, setDiscovery] = useState<AiDiscovery | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [playbook,  setPlaybook]  = useState<{ id: string; name: string }[]>([]);
  const [rules,     setRules]     = useState<Rule[]>([]);
  const [userChecks, setUserChecks] = useState<RuleCheck[]>([]);
  const [violations, setViolations] = useState<{ ruleId: string; date: string }[]>([]);
  const [macro,     setMacro]     = useState<MacroEventLite[] | null>(null);
  const [macroToday, setMacroToday] = useState<string | null>(null);

  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /* ── Clock (Israel time) ─────────────────────────────────────── */
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

  /* ── Load localStorage on mount, then reconcile with the cloud ── */
  const dashSyncReadyRef = useRef(false);
  useEffect(() => {
    const applyLocal = () => {
      try {
        const remStr = localStorage.getItem('onyx_dash_reminders_v2');
        if (remStr) {
          try { const arr = JSON.parse(remStr); if (Array.isArray(arr)) setReminders(arr); } catch {}
        } else {
          setReminders(STR[L].defaultReminders.map((t, i) => ({ id: 'r' + i, text: t, done: false })));
        }

        const planStr = localStorage.getItem('onyx_dash_planobj_' + todayKey());
        if (planStr) {
          try {
            const o = JSON.parse(planStr);
            if (o.goal != null) setGoal(o.goal);
            if (o.bias) setBias(o.bias);
            if (o.maxTrades) setMaxTrades(parseInt(o.maxTrades, 10) || 2);
            if (Array.isArray(o.setups)) setAllowedSetups(o.setups);
            setSaved({ goal: o.goal || '', bias: o.bias || '', maxTrades: String(o.maxTrades || '2'), note: o.note || '', setups: Array.isArray(o.setups) ? o.setups : [] });
          } catch {}
        }

        const cachedDiscovery = localStorage.getItem('onyx_ai_discovery_' + todayKey());
        if (cachedDiscovery) { try { setDiscovery(JSON.parse(cachedDiscovery)); } catch {} }

        // Rules + compliance (read-only here — the rules page owns writes).
        try { const r = localStorage.getItem('onyx_trading_rules'); if (r) setRules((JSON.parse(r) as Rule[]).filter(x => !x.deleted)); } catch {}
        try { const c = localStorage.getItem('onyx_rule_checks'); if (c) setUserChecks((JSON.parse(c) as RuleCheck[]).filter(x => !x.deleted)); } catch {}
        try { const v = localStorage.getItem('onyx_rule_violations'); if (v) setViolations((JSON.parse(v) as { ruleId: string; date: string; deleted?: boolean }[]).filter(x => !x.deleted)); } catch {}
        try { const p = localStorage.getItem('onyx_playbook'); if (p) setPlaybook((JSON.parse(p) as { id: string; name: string; deleted?: boolean }[]).filter(x => !x.deleted)); } catch {}

        setTrades(loadTrades());
      } catch {}
    };

    applyLocal();
    initSyncListeners();
    Promise.all([hydrateDashboard(), hydrateTradesFromCloud().catch(() => null)])
      .then(([dashChanged, merged]) => {
        if (dashChanged) applyLocal();
        if (merged) setTrades(merged);
        dashSyncReadyRef.current = true;
      })
      .catch(() => { dashSyncReadyRef.current = true; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dashSyncReadyRef.current) return;
    pushDashboard();
  }, [reminders, saved]);

  /* ── This week's real macro events (never invented — [] on failure) ── */
  useEffect(() => {
    fetch('/api/macro?scope=week')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { setMacro(Array.isArray(d?.events) ? d.events : []); setMacroToday(typeof d?.today === 'string' ? d.today : null); })
      .catch(() => setMacro([]));
  }, []);

  /* ── Today's single strongest AI discovery — the hero ─────────── */
  // PRO and up: a free user never triggers this network call at all — the
  // card below renders a locked teaser for them instead.
  useEffect(() => {
    if (isFree || trades.length < 3) { setDiscovery(null); return; }
    const cacheKey = 'onyx_ai_discovery_' + todayKey();
    const cached = localStorage.getItem(cacheKey);
    if (cached) { try { setDiscovery(JSON.parse(cached)); return; } catch {} }
    setDiscoveryLoading(true);
    fetch('/api/ai/discovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trades, lang: L }),
    })
      .then(r => r.json())
      .then(({ discovery: d }: { discovery: AiDiscovery | null }) => {
        if (!d) return;
        setDiscovery(d);
        try { localStorage.setItem(cacheKey, JSON.stringify(d)); } catch {}
      })
      .catch(() => {})
      .finally(() => setDiscoveryLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades]);

  /* ── Derived ─────────────────────────────────────────────────── */
  const activeSessionIdx = getActiveSessionIdx();
  const now = new Date();
  const dateStr = now.toLocaleDateString(L === 'he' ? 'he-IL' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  /* ── Greeting — Israel time (same clock the header shows), real name when Clerk has it ── */
  const idtHour = parseInt(clockStr.slice(0, 2), 10) || 0;
  const greetWord = idtHour < 5 || idtHour >= 22 ? s.greetNight
    : idtHour < 12 ? s.greetMorning
    : idtHour < 18 ? s.greetAfternoon
    : s.greetEvening;
  const greeting = firstName ? `${greetWord}, ${firstName}` : greetWord;

  const spec = SPEC[asset];
  const bal = num(balance), rk = num(risk), st = num(stop);
  const cash = bal * (rk / 100);
  const stdContracts   = st * spec.ptStd   > 0 ? Math.floor(cash / (st * spec.ptStd))   : 0;
  const microContracts = st * spec.ptMicro > 0 ? Math.floor(cash / (st * spec.ptMicro)) : 0;

  const planDirty = !(saved.goal === goal && saved.bias === bias && saved.maxTrades === String(maxTrades) && saved.setups.join('|') === allowedSetups.join('|'));

  /* ── Period stats + honest deltas ─────────────────────────────── */
  const todayISO2 = localISO(new Date());
  const startOfWeek = (weeks: number) => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + weeks * 7); return localISO(d); };
  const endOfWeek   = (weeks: number) => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + weeks * 7 + 6); return localISO(d); };
  const monthKey = todayISO2.slice(0, 7);
  const prevMonthKey = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return localISO(d).slice(0, 7); })();

  const sToday     = rangeStats(trades.filter(t => t.dateISO === todayISO2));
  const sWeek      = rangeStats(trades.filter(t => t.dateISO >= startOfWeek(0)));
  const sPrevWeek  = rangeStats(trades.filter(t => t.dateISO >= startOfWeek(-1) && t.dateISO <= endOfWeek(-1)));
  const sMonth     = rangeStats(trades.filter(t => t.dateISO.startsWith(monthKey)));
  const sPrevMonth = rangeStats(trades.filter(t => t.dateISO.startsWith(prevMonthKey)));
  const tradesToday = trades.filter(t => t.dateISO === todayISO2);

  /* ── Last 10 days' daily PnL — a real trend, not a decoration ────── */
  const dailyPnl = useMemo(() => {
    const days: { key: string; pnl: number; n: number }[] = [];
    for (let i = 9; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = localISO(d);
      const decided = trades.filter(t => t.dateISO === key && t.result !== 'OPEN');
      days.push({ key, pnl: decided.reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0), n: decided.length });
    }
    return days;
  }, [trades]);
  const maxAbsDailyPnl = Math.max(1, ...dailyPnl.map(d => Math.abs(d.pnl)));

  const ruleStats = useMemo(
    () => computeRuleStats(rules, trades, userChecks, todayISO2, violations),
    [rules, trades, userChecks, violations, todayISO2],
  );

  /* ── Next macro event this week (real feed, Israel date + time) ──── */
  // Only USD high-impact reports — the "red folder" events on ForexFactory.
  const nowMin = hhmmToMin(clockStr);
  const primaryMacro = (macro ?? [])
    .filter(e => e.impact === 'High' && e.currency === 'USD')
    .sort((a, b) => (a.dateIsrael + a.timeIsrael).localeCompare(b.dateIsrael + b.timeIsrael));
  const nextMacro = primaryMacro
    .find(e => e.dateIsrael > (macroToday ?? '') || (e.dateIsrael === macroToday && e.timeIsrael !== '' && hhmmToMin(e.timeIsrael) > nowMin));

  /* ── Daily state — the hero's single verdict. Real data only: rule
     violations, the trade cap the trader set, and whether a plan exists
     at all. Never a fabricated "risk remaining" figure. ────────────── */
  const activeSess = activeSessionIdx >= 0 ? SESS[activeSessionIdx] : null;
  const violatedToday = ruleStats.today.violated;
  const overCap = tradesToday.length >= maxTrades && maxTrades > 0;
  const dailyState: 'onTrack' | 'attention' | 'noPlan' =
    !saved.bias ? 'noPlan' : violatedToday > 0 || overCap ? 'attention' : 'onTrack';
  const dailyStateSub =
    violatedToday > 0 ? s.stateSubViolated(violatedToday)
    : dailyState === 'noPlan' ? s.stateSubNoPlan
    : overCap ? s.stateSubCap
    : s.stateSubOnTrack;
  const dailyStateLabel = dailyState === 'onTrack' ? s.stateOnTrack : dailyState === 'attention' ? s.stateAttention : s.stateNoPlan;
  const capPct = maxTrades > 0 ? Math.min(100, (tradesToday.length / maxTrades) * 100) : 0;

  /* ── Handlers ────────────────────────────────────────────────── */
  function handleSavePlan() {
    const trimmed = note.trim();
    if (trimmed) {
      const next = [...reminders, { id: 'r' + Date.now(), text: trimmed, done: false }];
      setReminders(next);
      try { localStorage.setItem('onyx_dash_reminders_v2', JSON.stringify(next)); } catch {}
    }
    const o: PlanSaved = { goal, bias, maxTrades: String(maxTrades), note: '', setups: allowedSetups };
    try { localStorage.setItem('onyx_dash_planobj_' + todayKey(), JSON.stringify(o)); } catch {}
    setSaved(o); setNote(''); setJustSaved(true);
    clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setJustSaved(false), 1800);
  }

  function toggleReminder(id: string) {
    const next = reminders.map(r => r.id === id ? { ...r, done: !r.done } : r);
    setReminders(next);
    try { localStorage.setItem('onyx_dash_reminders_v2', JSON.stringify(next)); } catch {}
  }
  function deleteReminder(id: string) {
    const next = reminders.filter(r => r.id !== id);
    setReminders(next);
    try { localStorage.setItem('onyx_dash_reminders_v2', JSON.stringify(next)); } catch {}
  }
  const toggleSetup = (name: string) => setAllowedSetups(a => a.includes(name) ? a.filter(x => x !== name) : [...a, name]);

  /* ── KPI story lines — a number never stands alone ────────────── */
  const pnlWeekStory = sPrevWeek.n === 0
    ? s.noPrevWeek
    : (() => { const d = pctDelta(sWeek.pnl, sPrevWeek.pnl); return d == null ? s.basedOn(sWeek.decided) : `${arrow(d)} ${Math.abs(Math.round(d))}% ${s.vsLastWeek}`; })();
  const winStory = sMonth.wr == null ? s.noData
    : sPrevMonth.wr == null ? s.basedOn(sMonth.decided)
    : `${arrow(sMonth.wr - sPrevMonth.wr)} ${Math.abs(Math.round(sMonth.wr - sPrevMonth.wr))} ${s.pts} ${s.vsLastMonth}`;
  const avgRStory = sMonth.avgR == null ? s.noData
    : sPrevMonth.avgR == null ? s.basedOn(sMonth.decided)
    : `${arrow(sMonth.avgR - sPrevMonth.avgR)} ${Math.abs(sMonth.avgR - sPrevMonth.avgR).toFixed(2)}R ${s.vsLastMonth}`;
  const pfStory = sMonth.pf == null ? s.noData : s.basedOn(sMonth.decided);

  const fmtR = (v: number | null) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + 'R');
  const fmtPct = (v: number | null) => (v == null ? '—' : Math.round(v) + '%');
  const fmtPf = (v: number | null) => (v == null ? '—' : v.toFixed(2));

  const conf = discovery ? CONF_META[discovery.confidenceLevel] : null;

  /* ════════════════════════════════════════════════════════════════
     Render
  ════════════════════════════════════════════════════════════════ */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ════ HEADER ════ */}
      <header className="dp-header">
        <div className="dp-header-left">
          <span className="dp-header-icon">◈</span>
          <span className="dp-header-title">{s.nav}</span>
          <span className="dp-header-live"><span className="dp-pulse-dot sm" />{s.liveTag}</span>
        </div>
        <div className="dp-header-right">
          <span className={`dp-plan-badge${isFree ? ' free' : ''}`}>{role.toUpperCase()}</span>
          <div className="dp-clock-wrap">
            <span className="dp-clock-label">{s.idt}</span>
            <span className="dp-clock-val" dir="ltr">{clockStr}</span>
          </div>
        </div>
      </header>

      {/* ════ SCROLL AREA ════ */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <div className="dp-cmd">

          {/* ════ HERO: greeting + daily state — one focal point, not a signal wall ════ */}
          <section className="dp-hero-row dp-reveal dp-rev-1">
            <div className="dp-hero-greet">
              <span className="dp-hero-eyebrow">{s.briefingK}</span>
              <h1 className="dp-hero-greeting">{greeting}</h1>
              <p className="dp-hero-date">
                {dateStr}
                {activeSess ? <> · <b>{s.sessionActive(L === 'he' ? activeSess.he : activeSess.en)}</b></> : <> · {s.noSession}</>}
              </p>
              <div className="dp-sessions">
                {SESS.map((sess, i) => (
                  <div key={sess.key} className={`dp-session-chip${i === activeSessionIdx ? ' active' : ''}`}>
                    <span className={`dp-session-dot${i === activeSessionIdx ? ' dp-pulse-dot' : ''}`} />
                    <span className="dp-session-label">{L === 'he' ? sess.he : sess.en}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="dp-hero-state">
              <div className="dp-hero-state-top">
                <span className="dp-hero-state-label">{s.dailyStateK}</span>
                <span className={`dp-state-pill ${dailyState}`}>{dailyStateLabel}</span>
              </div>
              <div className="dp-hero-state-value">{tradesToday.length} <span>/ {maxTrades} {s.tradesLabel}</span></div>
              <span className="dp-hero-state-sub">{dailyStateSub}</span>
              <div className="dp-hero-state-bar">
                <div className={`dp-hero-state-bar-fill${dailyState === 'attention' ? ' attention' : ''}`} style={{ width: `${capPct}%` }} />
              </div>
            </div>
          </section>

          {/* ════ AI INSIGHT OF THE DAY — the focal point ════ */}
          {isFree ? (
            <div className="dp-ai-locked dp-reveal dp-rev-2">
              <div aria-hidden className="dp-ai-locked-teaser">
                <span className="dp-ai-block-k">{s.aiLockedSampleK}</span>
                <p className="dp-ai-block-text">{s.aiLockedSampleText}</p>
              </div>
              <div className="dp-ai-locked-veil" />
              <div className="dp-ai-locked-inner">
                <div className="dp-ai-locked-icon">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                </div>
                <div className="dp-ai-locked-copy">
                  <div className="dp-ai-locked-eyebrow">{s.aiLockedEyebrow}</div>
                  <div className="dp-ai-locked-msg">{s.aiLockedMsgPre} <b>{s.aiLockedMsgBold}</b></div>
                </div>
                <Link href="/checkout" className="dp-ai-locked-cta">{s.aiLockedCta} →</Link>
              </div>
            </div>
          ) : (
            <div className="dp-ai-hero dp-reveal dp-rev-2">
              <div className="dp-ai-glow" />
              <div className="dp-ai-inner">
                <div className="dp-ai-head">
                  <span className="dp-ai-kicker">{s.aiHeroK}</span>
                  <span className="dp-ai-sub">{s.aiHeroSub}</span>
                </div>

                {discoveryLoading && !discovery ? (
                  <div className="dp-ai-waiting">
                    <TypingDots /><span className="dp-ai-waiting-text">{s.aiThinking}</span>
                  </div>
                ) : discovery ? (
                  <>
                    <h2 className="dp-ai-title">{discovery.title}</h2>
                    <div className="dp-ai-grid">
                      <div className="dp-ai-block">
                        <span className="dp-ai-block-k">{s.aiEvidenceK}</span>
                        <InsightText text={discovery.evidence} className="dp-ai-block-text" />
                      </div>
                      <div className="dp-ai-block">
                        <span className="dp-ai-block-k">{s.aiActionK}</span>
                        <InsightText text={discovery.action} className="dp-ai-block-text" />
                      </div>
                    </div>
                    <div className="dp-ai-foot">
                      {conf && (
                        <Tooltip text={s.aiSample(discovery.sampleSize)}>
                          <span className="dp-ai-conf" style={{ color: conf.fg, background: conf.bg, borderColor: conf.bd }}>
                            {conf.icon} {s.aiConfidenceK} · {discovery.confidenceLevel}
                          </span>
                        </Tooltip>
                      )}
                      <span className="dp-ai-sample">{s.aiSample(discovery.sampleSize)}</span>
                      <Link href="/dashboard/coach" className="dp-ai-link">{s.aiOpenCoach} →</Link>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="dp-ai-title">{s.aiWaiting}</h2>
                    <p className="dp-ai-block-text" style={{ maxWidth: 560 }}>{s.aiWaitingText}</p>
                    <div className="dp-ai-foot">
                      <Link href="/dashboard/journal" className="dp-ai-link">{s.ctaNewTrade} →</Link>
                    </div>
                  </>
                )}
                <span className="dp-ai-disc">{s.aiDisc}</span>
              </div>
            </div>
          )}

          {/* ════ ROW A: Plan + Tasks (a tool) | Performance (a state) ════ */}
          <div className="dp-section-label"><span>{s.sectionPlanK}</span></div>
          <div className="dp-row-a dp-reveal dp-rev-3">

            {/* ── PLAN + TASKS, merged ── */}
            <div className="panel dp-pad">
              <div className="dp-mission-head">
                <span className="dp-zone-title" style={{ color: 'var(--gold)' }}>{s.missionK}</span>
                {planDirty && <span className="dp-mission-dirty">{s.dirty}</span>}
              </div>

              <div className="dp-mission-grid">
                <div className="dp-mission-cell">
                  <span className="dp-field-label">{s.mBias}</span>
                  <div className="dp-seg-grid-4" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                    {(['bull', 'neutral', 'bear'] as const).map(k => (
                      <button key={k} className={`dp-bias-btn${bias === k ? ' sel-' + k : ''}`} onClick={() => setBias(k)}>
                        {k === 'bull' ? s.biasBull : k === 'bear' ? s.biasBear : s.biasNeutral}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="dp-mission-cell">
                  <span className="dp-field-label">{s.mMax}</span>
                  <div className="dp-max-stepper">
                    <button className="dp-stepper-btn" onClick={() => setMaxTrades(v => Math.max(1, v - 1))}>−</button>
                    <span className="dp-stepper-value">{maxTrades}</span>
                    <button className="dp-stepper-btn" onClick={() => setMaxTrades(v => Math.min(20, v + 1))}>+</button>
                  </div>
                </div>

                <div className="dp-mission-cell">
                  <span className="dp-field-label">{s.mRisk}</span>
                  <span className="dp-mission-val">${Math.round(cash).toLocaleString('en-US')} · {rk}%</span>
                </div>

                <div className="dp-mission-cell">
                  <span className="dp-field-label">{s.mObjective}</span>
                  <input className="dp-field-input" value={goal} onChange={e => setGoal(e.target.value)} placeholder={s.mObjectivePh} />
                </div>
              </div>

              <div className="dp-mission-cell" style={{ marginTop: 16 }}>
                <span className="dp-field-label">{s.mSetups}</span>
                {playbook.length === 0 ? (
                  <span className="dp-mission-empty">{s.mSetupsEmpty}</span>
                ) : (
                  <div className="dp-setup-chips">
                    {playbook.map(p => (
                      <button key={p.id} className={`dp-setup-chip${allowedSetups.includes(p.name) ? ' active' : ''}`} onClick={() => toggleSetup(p.name)}>
                        {p.name || '—'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="dp-mission-cell" style={{ marginTop: 16 }}>
                <span className="dp-field-label">{s.mNote}</span>
                <input className="dp-field-input" value={note} onChange={e => setNote(e.target.value)} placeholder={s.mNotePh} />
              </div>

              <button className={`dp-save-btn ${justSaved ? 'saved' : planDirty ? 'dirty' : 'idle'}`} onClick={handleSavePlan} style={{ marginTop: 18 }}>
                {justSaved ? s.savedOk + ' ✓' : s.save}
              </button>

              <div className="dp-plan-sep" />

              <span className="dp-field-label">{s.tasksK}</span>
              <div className="dp-tasks-list" style={{ marginTop: 10 }}>
                {reminders.map(r => (
                  <div key={r.id} className={`dp-reminder-chip${r.done ? ' done' : ''}`} onClick={() => toggleReminder(r.id)}>
                    <span className="dp-reminder-box"><span className="dp-reminder-check">{r.done ? '✓' : ''}</span></span>
                    <span className="dp-reminder-text">{r.text}</span>
                    <button className="dp-reminder-del" onClick={e => { e.stopPropagation(); deleteReminder(r.id); }}>×</button>
                  </div>
                ))}
              </div>
            </div>

            {/* ── PERFORMANCE — flat/borderless: how the day went, not a spreadsheet ── */}
            <div className="dp-flat">
              <div className="dp-flat-hd"><span className="dp-zone-title">{s.zonePerf}</span></div>

              <div className="dp-perf-hero-row">
                <span className="dp-perf-hero-val" style={{ color: sToday.n === 0 ? 'var(--w40)' : sToday.pnl >= 0 ? 'var(--bull)' : 'var(--bear)' }}>
                  {sToday.n === 0 ? '—' : money(sToday.pnl)}
                </span>
                <span className="dp-perf-hero-label">{s.pnlToday}</span>
              </div>
              <span className="dp-stat-story">{sToday.n === 0 ? s.noData : s.basedOn(sToday.decided)}</span>

              <div className="dp-stat-sep" />

              <div className="dp-mini-grid">
                <div className="dp-stat-row">
                  <span className="dp-stat-label">{s.pnlWeek}</span>
                  <span className="dp-stat-value" style={{ fontSize: 18, color: sWeek.n === 0 ? 'var(--w40)' : sWeek.pnl >= 0 ? 'var(--bull)' : 'var(--bear)' }}>
                    {sWeek.n === 0 ? '—' : money(sWeek.pnl)}
                  </span>
                  <span className="dp-stat-story">{sWeek.n === 0 ? s.noData : pnlWeekStory}</span>
                </div>
                <div className="dp-stat-row">
                  <span className="dp-stat-label">{s.pnlMonth}</span>
                  <span className="dp-stat-value" style={{ fontSize: 18, color: sMonth.n === 0 ? 'var(--w40)' : sMonth.pnl >= 0 ? 'var(--bull)' : 'var(--bear)' }}>
                    {sMonth.n === 0 ? '—' : money(sMonth.pnl)}
                  </span>
                  <span className="dp-stat-story">{sMonth.n === 0 ? s.noData : s.basedOn(sMonth.decided)}</span>
                </div>
              </div>

              <div className="dp-mini-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginTop: 18 }}>
                <div className="dp-stat-row">
                  <span className="dp-stat-label">{s.winRate}</span>
                  <div className="dp-perf-bar-track"><div className="dp-perf-bar-fill" style={{ width: `${sMonth.wr ?? 0}%` }} /></div>
                  <span className="dp-stat-value" style={{ fontSize: 18 }}>{fmtPct(sMonth.wr)}</span>
                  <span className="dp-stat-story">{winStory}</span>
                </div>
                <div className="dp-stat-row">
                  <span className="dp-stat-label">{s.avgR}</span>
                  <span className="dp-stat-value" style={{ fontSize: 18, color: (sMonth.avgR ?? 0) >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{fmtR(sMonth.avgR)}</span>
                  <span className="dp-stat-story">{avgRStory}</span>
                </div>
                <div className="dp-stat-row">
                  <span className="dp-stat-label">{s.profitFactor}</span>
                  <span className="dp-stat-value" style={{ fontSize: 18 }}>{fmtPf(sMonth.pf)}</span>
                  <span className="dp-stat-story">{pfStory}</span>
                </div>
              </div>

              <div className="dp-stat-sep" />

              <span className="dp-stat-label">{s.perfTrendK}</span>
              <div className="dp-perf-spark">
                {dailyPnl.map(d => (
                  <div key={d.key} className="dp-spark-col" title={`${d.key} · ${d.n === 0 ? s.noData : money(d.pnl)}`}>
                    {d.n === 0 ? (
                      <div className="dp-spark-bar flat" />
                    ) : (
                      <div
                        className={`dp-spark-bar ${d.pnl >= 0 ? 'bull' : 'bear'}`}
                        style={{ height: `${Math.max((Math.abs(d.pnl) / maxAbsDailyPnl) * 50, 4)}%`, [d.pnl >= 0 ? 'bottom' : 'top']: '50%' }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ════ ROW B: Macro (information) | Tools (actions) ════ */}
          <div className="dp-section-label"><span>{s.sectionToolsK}</span></div>
          <div className="dp-row-b dp-reveal dp-rev-3">

            {/* ── MACRO — flat/borderless list, tied to today's plan ── */}
            <div className="dp-flat">
              <div className="dp-flat-hd">
                <span className="dp-zone-title">{s.macroK}</span>
                <span className="dp-stat-story">{saved.bias ? (L === 'he' ? 'לפי התוכנית שהגדרת' : "vs. today's plan") : ''}</span>
              </div>
              <div className="dp-macro-list">
                {macro == null ? (
                  <span className="dp-mission-empty">…</span>
                ) : primaryMacro.length === 0 ? (
                  <span className="dp-mission-empty">{s.macroEmpty}</span>
                ) : (
                  primaryMacro.slice(0, 8).map((e, i) => {
                    const isNext = !!nextMacro && e.dateIsrael === nextMacro.dateIsrael && e.title === nextMacro.title && e.timeIsrael === nextMacro.timeIsrael;
                    const dayLabel = e.dateIsrael === macroToday ? s.macroToday : weekdayShort(e.dateIsrael, L === 'he' ? 'he-IL' : 'en-US');
                    return (
                      <div key={`${e.dateIsrael}-${e.title}-${i}`} className={`dp-macro-row${isNext ? ' next' : ''}`}>
                        <span className="dp-macro-impact" aria-hidden />
                        <span className="dp-macro-day">{dayLabel}</span>
                        <span className="dp-macro-time" dir="ltr">{e.timeIsrael || '—'}</span>
                        <span className="dp-macro-title">{e.title}</span>
                        {isNext && <span className="dp-macro-next-tag">{s.macroNext}</span>}
                        <span className="dp-macro-cur">{e.currency}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* ── TOOLS — quick actions + a collapsible risk calculator ── */}
            <div className="dp-flat">
              <div className="dp-flat-hd"><span className="dp-zone-title">{s.zoneTools}</span></div>

              <div className="dp-quick">
                <Link href="/dashboard/journal" className="dp-cta-primary"><span aria-hidden>✎</span>{s.ctaNewTrade}</Link>
                <Link href="/dashboard/journal" className="dp-cta-ghost"><span aria-hidden>▤</span>{s.ctaJournal}</Link>
                <Link href="/dashboard/coach" className="dp-cta-ghost"><span aria-hidden>◈</span>{s.ctaCoach}</Link>
              </div>

              <div className="dp-plan-sep" />

              <button className={`dp-calc-toggle${calcOpen ? ' open' : ''}`} onClick={() => setCalcOpen(o => !o)} aria-expanded={calcOpen}>
                <span aria-hidden>⌘</span>
                <span className="dp-calc-toggle-label">{s.calcK}</span>
                <span className="dp-calc-toggle-state">{calcOpen ? s.calcHide : s.calcShow}</span>
                <span aria-hidden className="dp-calc-toggle-chevron">▾</span>
              </button>

              {calcOpen && (
                <div className="dp-calc-body">
                  <div className="dp-seg-grid-2">
                    {(Object.keys(SPEC) as AssetKey[]).map(k => (
                      <button key={k} className={`dp-seg-btn${asset === k ? ' active' : ''}`} onClick={() => setAsset(k)}>{k}</button>
                    ))}
                  </div>
                  <div className="dp-inputs-2" style={{ marginTop: 12 }}>
                    <div>
                      <span className="dp-field-label">{s.balance}</span>
                      <input className="dp-calc-input" value={balance} onChange={e => setBalance(e.target.value)} inputMode="numeric" dir="ltr" />
                    </div>
                    <div>
                      <span className="dp-field-label">{s.stop}</span>
                      <input className="dp-calc-input" value={stop} onChange={e => setStop(e.target.value)} inputMode="numeric" dir="ltr" />
                    </div>
                  </div>
                  <div className="dp-seg-grid-4" style={{ marginTop: 12 }}>
                    {RISK_PRESETS.map(p => (
                      <button key={p} className={`dp-seg-btn${num(risk) === p ? ' active' : ''}`} onClick={() => setRisk(String(p))}>{p}%</button>
                    ))}
                  </div>
                  <div className="dp-calc-out">
                    <span className="dp-cash-label">{s.cashRisk}</span>
                    <span className="dp-cash-value">${Math.round(cash).toLocaleString('en-US')}</span>
                  </div>
                  <div className="dp-contracts">
                    <div className="dp-contract-cell">
                      <span className="dp-contract-label">{s.standard} · {spec.std}</span>
                      <span className="dp-contract-value">{stdContracts}</span>
                    </div>
                    <div className="dp-contract-cell">
                      <span className="dp-contract-label">{s.micro} · {spec.micro}</span>
                      <span className="dp-contract-value">{microContracts}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
