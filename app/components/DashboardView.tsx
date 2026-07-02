'use client';

import './dp.css';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '../hooks/useLanguage';
import { loadTrades } from '../lib/journal';
import { SESS, getActiveSessionIdx } from '../lib/sessions';
import TypingDots from './TypingDots';
import Tooltip from './Tooltip';
import InsightText from './InsightText';

const CLERK_ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/* ── Constants ──────────────────────────────────────────────────── */
const SPEC = {
  ES: { std: 'ES', micro: 'MES', ptStd: 50, ptMicro: 5, tag: 'S&P' },
  NQ: { std: 'NQ', micro: 'MNQ', ptStd: 20, ptMicro: 2, tag: 'NDX' },
} as const;
type AssetKey = keyof typeof SPEC;
const RISK_PRESETS = [0.25, 0.5, 1, 2] as const;

type ConfidenceLevel = 'low' | 'medium' | 'high';
/** Mirrors app/lib/ai/discovery.ts's AiDiscovery — kept as a local type (not
    imported) so this client component never pulls in the server-only
    Anthropic SDK module. */
interface AiDiscovery {
  title: string;
  evidence: string;
  action: string;
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
}

const CONF_META: Record<ConfidenceLevel, { fg: string; bg: string; bd: string; icon: string }> = {
  high:   { fg: 'var(--bull)', bg: 'rgba(111,165,128,.1)',  bd: 'rgba(111,165,128,.32)', icon: '✓' },
  medium: { fg: 'var(--gold)', bg: 'var(--gold-08)',        bd: 'var(--gold-20)',        icon: '~' },
  low:    { fg: 'var(--w55)',  bg: 'rgba(255,255,255,.04)', bd: 'rgba(255,255,255,.08)', icon: '!' },
};

const COACH_META = [
  { fg: 'var(--bull)', bg: 'rgba(111,165,128,.1)', bd: 'rgba(111,165,128,.32)', icon: '▲' },
  { fg: 'var(--gold)', bg: 'var(--gold-08)',        bd: 'var(--gold-20)',         icon: '◈' },
  { fg: 'var(--w55)',  bg: 'rgba(255,255,255,.04)', bd: 'rgba(255,255,255,.08)',  icon: '◈' },
] as const;

const STR = {
  he: {
    nav: ['סקירה','יומן מסחר','אנליטיקה','פלייבוק','מנוע חוקים'],
    live: 'חי', view: 'תצוגה', varA: 'טרמינל', varB: 'תקציר', idt: 'שעון ישראל',
    noSession: 'אין סשן פעיל',
    greetMorning: 'בוקר טוב', greetAfternoon: 'צהריים טובים', greetEvening: 'ערב טוב',
    briefing: 'הסקירה היומית שלך, במבט אחד.',
    perf: 'ביצועים', today: 'היום', week: 'השבוע', month: 'החודש', perfHint: 'מאז תחילת החודש',
    winRate: 'אחוז הצלחה', profitFactor: 'פרופיט פקטור', avgR: 'R ממוצע',
    planK: 'תוכנית המסחר להיום', planPh: 'ביאס, רמות מפתח, סשנים לצפייה, תרחישים...',
    autosave: 'נשמר אוטומטית',
    calcK: 'מחשבון סיכון', asset: 'נכס', balance: 'הון בחשבון', risk: 'סיכון',
    stop: 'סטופ · נקודות', cashRisk: 'סכום בסיכון', standard: 'סטנדרט', micro: 'מיקרו',
    remindersK: 'תזכורות אישיות',
    defaultReminders: ['ללא עסקאות לפני פתיחת לונדון','מקסימום 2 עסקאות ביום','עצור את המסחר אחרי יום של 2R הפסד','צלם מסך לכל כניסה'],
    accBalance: 'הון בחשבון', accToday: 'P&L היום', accRisk: 'סיכון לעסקה',
    ctaNewTrade: 'תיעוד עסקה חדשה', ctaJournal: 'פתח יומן מסחר',
    statusReady: 'מוכן למסחר',
    heroWelcome: 'ברוך הבא,', badgeAccountActive: 'חשבון פעיל', badgeDisciplineK: 'ציון משמעת', badgeDisciplineEmpty: 'אין עדיין נתונים',
    badgeDisciplineTip: 'מחושב לפי אחוז העסקאות התואמות את תוכנית המסחר והביאס היומי.',
    aiCoach: 'מאמן ה-AI', coachStatus: 'מבוסס על היומן שלך',
    coachFocus: 'לפי היומן שלך, חלון NY AM הניב את התוצאות הטובות ביותר. שווה לשקול לתת לו עדיפות — ההחלטה תמיד שלך.',
    coachDisc: 'התובנות מבוססות על היומן האישי שלך ואינן מהוות ייעוץ או המלצת מסחר.',
    cFocusK: 'הפוקוס של היום', cEvidenceK: 'ראיות', cConfidenceK: 'רמת ביטחון', cActionK: 'פעולה',
    pGoalK: 'המטרה של היום', pGoalPh: 'מה תרצה להשיג היום?',
    pBiasK: 'הביאס שלי', biasBull: 'עולה', biasBear: 'יורד', biasNeutral: 'ניטרלי',
    pMaxK: 'מקסימום עסקאות', pNoteK: 'תזכורת אישית',
    pNotePh: 'כתוב תזכורת — תישמר ברשימה למטה',
    pSaveK: 'שמור תוכנית', pSavedK: 'נשמר', pDirtyK: 'שינויים שלא נשמרו',
    disclaimer: 'נתוני דמו · למחקר ולמטרות לימוד בלבד',
    stTradingK: 'סטטוס מסחר', stTradingV: 'מוכן', stRiskK: 'סטטוס סיכון',
    stRiskV: 'בתוך הגבולות', stDiscK: 'משמעת', stDiscV: 'רצף 6 ימים',
    stHealthK: 'בריאות החשבון', stHealthV: 'חזקה',
    focusK: 'הפוקוס של היום', rTrend: 'מגמה', rSession: 'סשן',
    stDiscVEmpty: 'התחל היום',
    coachStatusEmpty: 'ממתין לעסקאות הראשונות',
    coachWelcomeTitle: 'ברוך הבא',
    coachWelcomeText: 'ברוך הבא ל-Onyx. ברגע שתתחיל לתעד עסקאות, המאמן יזהה עבורך דפוסים — מתי אתה מרוויח, היכן אתה מפסיד, ומה כדאי לשפר. ההחלטה תמיד נשארת שלך.',
    emptyPerfTitle: 'אין עדיין נתוני ביצועים',
    emptyPerfSub: 'הזן את העסקה הראשונה שלך כדי שהמערכת תוכל להתחיל לחשב את ציון המשמעת, אחוז ההצלחה ופרופיט פקטור שלך.',
  },
  en: {
    nav: ['Overview','Trade Journal','Analytics','Playbook','Rules Engine'],
    live: 'LIVE', view: 'VIEW', varA: 'TERMINAL', varB: 'BRIEF', idt: 'ISRAEL TIME',
    noSession: 'NO ACTIVE SESSION',
    greetMorning: 'Good morning', greetAfternoon: 'Good afternoon', greetEvening: 'Good evening',
    briefing: 'Your daily briefing, at a glance.',
    perf: 'PERFORMANCE', today: 'TODAY', week: 'THIS WEEK', month: 'THIS MONTH', perfHint: 'Month to date',
    winRate: 'WIN RATE', profitFactor: 'PROFIT FACTOR', avgR: 'AVG R',
    planK: "TODAY'S TRADING PLAN", planPh: 'Bias, key levels, sessions to watch, scenarios...',
    autosave: 'AUTO-SAVED',
    calcK: 'RISK CALCULATOR', asset: 'ASSET', balance: 'ACCOUNT BALANCE', risk: 'RISK',
    stop: 'STOP · POINTS', cashRisk: 'CASH AT RISK', standard: 'STANDARD', micro: 'MICRO',
    remindersK: 'PERSONAL REMINDERS',
    defaultReminders: ['No trades before London open','Max 2 trades per day','Stop trading after a -2R day','Screenshot every entry'],
    accBalance: 'ACCOUNT BALANCE', accToday: "TODAY'S P&L", accRisk: 'RISK / TRADE',
    ctaNewTrade: 'Log New Trade', ctaJournal: 'Open Trade Journal',
    statusReady: 'READY TO TRADE',
    heroWelcome: 'Welcome,', badgeAccountActive: 'Account Active', badgeDisciplineK: 'Discipline Score', badgeDisciplineEmpty: 'No data yet',
    badgeDisciplineTip: 'Calculated from the percentage of trades that matched your trading plan and declared daily bias.',
    aiCoach: 'AI COACH', coachStatus: 'Based on your journal',
    coachFocus: 'Based on your journal, the NY AM window has produced your best results. It may be worth prioritizing it — the decision is always yours.',
    coachDisc: 'Insights are based on your own journal and are not financial or trading advice.',
    cFocusK: "TODAY'S FOCUS", cEvidenceK: 'EVIDENCE', cConfidenceK: 'CONFIDENCE', cActionK: 'ACTION',
    pGoalK: "TODAY'S GOAL", pGoalPh: 'What do you want to achieve today?',
    pBiasK: 'MY BIAS', biasBull: 'BULLISH', biasBear: 'BEARISH', biasNeutral: 'NEUTRAL',
    pMaxK: 'MAX TRADES', pNoteK: 'PERSONAL REMINDER',
    pNotePh: 'Write a reminder — it will be saved below',
    pSaveK: 'Save plan', pSavedK: 'Saved', pDirtyK: 'Unsaved changes',
    disclaimer: 'Demo data · For research and educational use only',
    stTradingK: 'TRADING STATUS', stTradingV: 'READY', stRiskK: 'RISK STATUS',
    stRiskV: 'WITHIN LIMITS', stDiscK: 'DISCIPLINE', stDiscV: '6-DAY STREAK',
    stHealthK: 'ACCOUNT HEALTH', stHealthV: 'STRONG',
    focusK: "TODAY'S FOCUS", rTrend: 'TREND', rSession: 'SESSION',
    stDiscVEmpty: 'START TODAY',
    coachStatusEmpty: 'Waiting for first trades',
    coachWelcomeTitle: 'Welcome',
    coachWelcomeText: 'Welcome to Onyx. Once you start logging trades, the coach will identify patterns for you — when you profit, where you lose, and what\'s worth improving. The decision is always yours.',
    emptyPerfTitle: 'No performance data yet',
    emptyPerfSub: 'Log your first trade so the system can start calculating your discipline score, win rate, and profit factor.',
  },
} as const;

/* ── Types ──────────────────────────────────────────────────────── */
interface Reminder { id: string; text: string; done: boolean; }
type Lang = 'he' | 'en';

/* ── Helpers ────────────────────────────────────────────────────── */
const todayKey = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? n : 0; };
const money = (n: number) => (n >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');

/* ══════════════════════════════════════════════════════════════════
   Component
══════════════════════════════════════════════════════════════════ */
export default function DashboardView() {
  const { lang } = useLanguage();
  const L = lang as Lang;
  const s = STR[L];
  const isRTL = L === 'he';

  /* ── State ────────────────────────────────────────────────────── */
  const [variation, setVariation] = useState<'A' | 'B'>('A');
  const [asset,     setAsset]     = useState<AssetKey>('ES');
  const [balance,   setBalance]   = useState('50000');
  const [risk,      setRisk]      = useState('1');
  const [stop,      setStop]      = useState('10');
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [plan,      setPlan]      = useState('');
  const [goal,      setGoal]      = useState('');
  const [bias,      setBias]      = useState<'' | 'bull' | 'neutral' | 'bear'>('');
  const [maxTrades, setMaxTrades] = useState(2);
  const [note,      setNote]      = useState('');
  const [saved,     setSaved]     = useState({ goal: '', bias: '', maxTrades: '2', note: '' });
  const [justSaved, setJustSaved] = useState(false);
  const [clockStr,  setClockStr]  = useState('00:00:00');
  const [anim,      setAnim]      = useState({ today: 0, week: 0, month: 0, win: 0, pf: 0, avgr: 0 });
  const [userName,  setUserName]  = useState('');
  const [trades,    setTrades]    = useState<ReturnType<typeof loadTrades>>([]);
  const [focus,     setFocus]     = useState('');
  const [focusSaved,setFocusSaved]= useState(false);
  const [discovery, setDiscovery] = useState<AiDiscovery | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryUpdatedAt, setDiscoveryUpdatedAt] = useState<string | null>(null);
  const [discoveryHistory, setDiscoveryHistory] = useState<{ date: string; discovery: AiDiscovery }[]>([]);
  const [showPrevDiscoveries, setShowPrevDiscoveries] = useState(false);
  const isEmpty = trades.length === 0;

  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /* ── Clock (Israel time) ─────────────────────────────────────── */
  useEffect(() => {
    const update = () => setClockStr(new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour12: false }));
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, []);

  /* ── data-lang + dir on <html> ──────────────────────────────── */
  useEffect(() => {
    document.documentElement.setAttribute('data-lang', L);
    document.documentElement.dir = L === 'he' ? 'rtl' : 'ltr';
  }, [L]);

  /* ── Load localStorage on mount ──────────────────────────────── */
  useEffect(() => {
    try {
      const v = localStorage.getItem('onyx_dash_var');
      if (v === 'A' || v === 'B') setVariation(v);

      const p = localStorage.getItem('onyx_dash_plan_' + todayKey());
      if (p != null) setPlan(p);

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
          if (o.bias)         setBias(o.bias);
          if (o.maxTrades)    setMaxTrades(parseInt(o.maxTrades, 10) || 2);
          setSaved({ goal: o.goal || '', bias: o.bias || '', maxTrades: String(o.maxTrades || '2'), note: o.note || '' });
        } catch {}
      }

      const storedName = localStorage.getItem('onyx_user_name');
      if (storedName) setUserName(storedName);

      const f = localStorage.getItem('onyx_focus_' + todayKey());
      if (f != null) setFocus(f);

      const cachedDiscovery = localStorage.getItem('onyx_ai_discovery_' + todayKey());
      if (cachedDiscovery) {
        try {
          setDiscovery(JSON.parse(cachedDiscovery));
          const stamp = localStorage.getItem('onyx_ai_discovery_' + todayKey() + '_time');
          if (stamp) setDiscoveryUpdatedAt(stamp);
        } catch {}
      }
      const historyStr = localStorage.getItem('onyx_ai_discovery_history');
      if (historyStr) { try { setDiscoveryHistory(JSON.parse(historyStr)); } catch {} }

      const t = loadTrades();
      setTrades(t);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Fetch today's single strongest AI discovery for the hero block ── */
  useEffect(() => {
    if (trades.length < 3) { setDiscovery(null); return; }
    const cacheKey = 'onyx_ai_discovery_' + todayKey();
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        setDiscovery(JSON.parse(cached));
        const cachedTime = localStorage.getItem(cacheKey + '_time');
        if (cachedTime) setDiscoveryUpdatedAt(cachedTime);
        return;
      } catch {}
    }
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
        const stamp = new Date().toLocaleTimeString(L === 'he' ? 'he-IL' : 'en-US', { hour: '2-digit', minute: '2-digit' });
        setDiscoveryUpdatedAt(stamp);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(d));
          localStorage.setItem(cacheKey + '_time', stamp);
          const withoutToday = discoveryHistory.filter(h => h.date !== todayKey());
          const updated = [{ date: todayKey(), discovery: d }, ...withoutToday].slice(0, 14);
          setDiscoveryHistory(updated);
          localStorage.setItem('onyx_ai_discovery_history', JSON.stringify(updated));
        } catch {}
      })
      .catch(() => {})
      .finally(() => setDiscoveryLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades]);

  /* ── Animate KPI metrics from real trade data ───────────────── */
  useEffect(() => {
    if (isEmpty) { setAnim({ today: 0, week: 0, month: 0, win: 0, pf: 0, avgr: 0 }); return; }
    const closed = trades.filter(t => t.result !== 'OPEN');
    const wins   = closed.filter(t => t.result === 'WIN');
    const losses = closed.filter(t => t.result === 'LOSS');
    const winPct = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const sumWinR  = wins.reduce((s, t) => s + Math.abs(t.tradeR ?? 0), 0);
    const sumLossR = losses.reduce((s, t) => s + Math.abs(t.tradeR ?? 0), 0);
    const pf   = sumLossR > 0 ? sumWinR / sumLossR : sumWinR > 0 ? 99 : 0;
    const avgr = closed.length > 0 ? closed.reduce((s, t) => s + (t.tradeR ?? 0), 0) / closed.length : 0;
    const targets = { today: 0, week: 0, month: 0, win: winPct, pf, avgr };
    const dur = 1100, t0 = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setAnim({ today: 0, week: 0, month: 0, win: targets.win * e, pf: targets.pf * e, avgr: targets.avgr * e });
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isEmpty, trades]);

  /* ── Derived values ──────────────────────────────────────────── */
  const activeSessionIdx = getActiveSessionIdx();
  const now     = new Date();
  const idtDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const h       = idtDate.getHours();
  const greetWord = h < 12 ? s.greetMorning : h < 17 ? s.greetAfternoon : s.greetEvening;
  const displayName = userName || (isRTL ? 'אורח' : 'Trader');
  const dateStr = now.toLocaleDateString(L === 'he' ? 'he-IL' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  /* ── Calculator ──────────────────────────────────────────────── */
  const spec = SPEC[asset];
  const bal  = num(balance), rk = num(risk), st = num(stop);
  const cash = bal * (rk / 100);
  const stdContracts   = st * spec.ptStd   > 0 ? Math.floor(cash / (st * spec.ptStd))   : 0;
  const microContracts = st * spec.ptMicro > 0 ? Math.floor(cash / (st * spec.ptMicro)) : 0;
  const cashStr = '$' + Math.round(cash).toLocaleString('en-US');

  /* ── Plan dirty check ────────────────────────────────────────── */
  const planDirty    = !(saved.goal === goal && saved.bias === bias && saved.maxTrades === String(maxTrades) && saved.note === note);
  const saveBtnClass = `dp-save-btn ${justSaved ? 'saved' : planDirty ? 'dirty' : 'idle'}`;
  const saveBtnText  = justSaved ? s.pSavedK + ' ✓' : s.pSaveK;

  /* ── Handlers ────────────────────────────────────────────────── */
  function handleSetVariation(v: 'A' | 'B') {
    setVariation(v);
    try { localStorage.setItem('onyx_dash_var', v); } catch {}
  }

  function handleSavePlan() {
    const trimmed = note.trim();
    if (trimmed) {
      const next = [...reminders, { id: 'r' + Date.now(), text: trimmed, done: false }];
      setReminders(next);
      try { localStorage.setItem('onyx_dash_reminders_v2', JSON.stringify(next)); } catch {}
    }
    const o = { goal, bias, maxTrades: String(maxTrades), note: '' };
    try { localStorage.setItem('onyx_dash_planobj_' + todayKey(), JSON.stringify(o)); } catch {}
    setSaved(o); setNote(''); setJustSaved(true);
    clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setJustSaved(false), 1800);
  }

  function handleSavePlanText(v: string) {
    setPlan(v);
    try { localStorage.setItem('onyx_dash_plan_' + todayKey(), v); } catch {}
  }

  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function handleSaveFocus() {
    try { localStorage.setItem('onyx_focus_' + todayKey(), focus); } catch {}
    setFocusSaved(true);
    clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => setFocusSaved(false), 1800);
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

  /* ── Real trade stats per period ────────────────────────────── */
  function calcPeriodStats(filter: (t: { dateISO: string }) => boolean) {
    const filtered = trades.filter(t => filter(t) && (t.result === 'WIN' || t.result === 'LOSS' || t.result === 'BE'));
    const w = filtered.filter(t => t.result === 'WIN').length;
    const l = filtered.filter(t => t.result === 'LOSS').length;
    const total = w + l;
    const wr = total > 0 ? Math.round((w / total) * 100) : 0;
    const totalR = filtered.reduce((sum, t) => sum + (t.tradeR ?? 0), 0);
    const totalPnl = filtered.reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0);
    const wlStr = total === 0 ? '—' : `${w}W · ${l}L`;
    const wrStr = total === 0 ? '—' : `${wr}%`;
    const rStr  = total === 0 ? '—' : (totalR >= 0 ? '+' : '') + totalR.toFixed(2) + 'R';
    return { pnl: totalPnl, wl: wlStr, wr: wrStr, r: rStr };
  }
  const todayISO2 = new Date().toLocaleDateString('en-CA');
  const weekStart = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toLocaleDateString('en-CA'); })();
  const monthStart = new Date().toLocaleDateString('en-CA').slice(0, 7);
  const statsToday = calcPeriodStats(t => t.dateISO === todayISO2);
  const statsWeek  = calcPeriodStats(t => t.dateISO >= weekStart);
  const statsMonth = calcPeriodStats(t => t.dateISO.startsWith(monthStart));
  const periods = [
    { label: s.today, ...statsToday },
    { label: s.week,  ...statsWeek  },
    { label: s.month, ...statsMonth },
  ];
  const acctStats = [
    { label: s.accBalance, value: '$' + bal.toLocaleString('en-US'), color: '#fff' },
    { label: s.accToday,   value: money(statsToday.pnl),             color: statsToday.pnl >= 0 ? 'var(--bull)' : 'var(--bear)' },
    { label: s.accRisk,    value: '$' + Math.round(bal * rk / 100).toLocaleString('en-US') + ' · ' + rk + '%', color: 'var(--gold)' },
  ];
  /* Discipline score — % of closed trades taken aligned with the declared daily bias. Real data only. */
  const closedAllTrades = trades.filter(t => t.result !== 'OPEN');
  const alignedTrades = closedAllTrades.filter(t => t.biasAlignment === 'ALIGNED');
  const disciplineScore = closedAllTrades.length > 0 ? Math.round((alignedTrades.length / closedAllTrades.length) * 100) : null;
  const statusChips = [
    { k: s.stTradingK, v: s.stTradingV, c: 'var(--bull)' },
    { k: s.stRiskK,    v: s.stRiskV,    c: 'var(--bull)' },
    { k: s.stDiscK,    v: isEmpty ? s.stDiscVEmpty : s.stDiscV,  c: isEmpty ? 'var(--w40)' : 'var(--gold)' },
    { k: s.stHealthK,  v: s.stHealthV,  c: 'var(--bull)' },
  ];
  const verdictMap: Record<string, string> = { bull: 'BULLISH', bear: 'BEARISH', neutral: 'NEUTRAL' };
  const toneMap:    Record<string, string> = { bull: 'bull',    bear: 'bear',    neutral: 'neutral'  };
  const trendMap:   Record<string, string> = { bull: s.biasBull, bear: s.biasBear, neutral: s.biasNeutral };
  const savedBias = saved.bias || '';

  /* ════════════════════════════════════════════════════════════════
     Render
  ════════════════════════════════════════════════════════════════ */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ════ HEADER ════ */}
      <header className="dp-header">
        <div className="dp-header-left">
          <span className="dp-header-icon">◈</span>
          <span className="dp-header-title">{s.nav[0]}</span>
        </div>
        <div className="dp-header-right">
          <div className="dp-clock-wrap">
            <span className="dp-clock-label">{s.idt}</span>
            <span className="dp-clock-val" dir="ltr">{clockStr}</span>
          </div>
          <div className="dp-view-wrap">
            <span className="dp-view-label">{s.view}</span>
            <div className="dp-view-seg">
              <button className={`dp-view-btn${variation === 'A' ? ' active' : ''}`} onClick={() => handleSetVariation('A')}>{s.varA}</button>
              <button className={`dp-view-btn${variation === 'B' ? ' active' : ''}`} onClick={() => handleSetVariation('B')}>{s.varB}</button>
            </div>
          </div>
        </div>
      </header>

      {/* ════ SCROLL AREA ════ */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>

        {/* ════ VARIATION A — TERMINAL ════ */}
        <div className={`dp-content${variation === 'A' ? ' active' : ''}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

            {/* ── HERO ── */}
            <div className="dp-hero dp-reveal">
              <div className="dp-hero-glow" />
              <div className="dp-hero-grid">
                <div>
                  <div className="dp-greeting-row">
                    <span className="dp-greet-label">{greetWord}</span>
                    <span className="dp-status-pill">
                      <span className="dp-pulse-dot" style={{ width: 6, height: 6 }} />
                      <span className="dp-status-pill-text">{s.statusReady}</span>
                    </span>
                  </div>
                  <h1 className="dp-hero-date">{s.heroWelcome} {displayName}</h1>
                  <div className="dp-hero-subdate">{dateStr}</div>
                  <p className="dp-hero-brief">{s.briefing}</p>
                  <div className="dp-statusbar">
                    <span className="dp-statusbar-badge">
                      <span className="dp-pulse-dot" style={{ width: 6, height: 6, background: 'var(--bull)', boxShadow: '0 0 8px var(--bull)' }} />
                      <b>{s.badgeAccountActive}</b>
                    </span>
                    <span className="dp-statusbar-sep" />
                    <Tooltip text={s.badgeDisciplineTip}>
                      <span className="dp-statusbar-badge" style={{ cursor: 'default' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', boxShadow: '0 0 8px var(--gold)' }} />
                        {s.badgeDisciplineK}: <b>{disciplineScore !== null ? disciplineScore + '%' : s.badgeDisciplineEmpty}</b>
                      </span>
                    </Tooltip>
                  </div>
                  <div className="dp-sessions">
                    {SESS.map((sess, i) => (
                      <div key={sess.key} className={`dp-session-chip${i === activeSessionIdx ? ' active' : ''}`}>
                        <span className={`dp-session-dot${i === activeSessionIdx ? ' dp-pulse-dot' : ''}`} />
                        <span className="dp-session-label">{sess[L]}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="dp-acct-grid">
                    {acctStats.map((at, i) => (
                      <div key={i} className="dp-acct-cell">
                        <div className="dp-acct-label">{at.label}</div>
                        <div className="dp-acct-value" dir="ltr" style={{ color: at.color, textAlign: isRTL ? 'right' : 'left' }}>{at.value}</div>
                      </div>
                    ))}
                  </div>
                  <Link href="/dashboard/journal" className="dp-cta-primary">
                    <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
                    <span>{s.ctaNewTrade}</span>
                  </Link>
                  <Link href="/dashboard/journal" className="dp-cta-ghost">
                    <span>{s.ctaJournal}</span>
                    <span style={{ color: 'var(--gold-45)' }}>{isRTL ? '←' : '→'}</span>
                  </Link>
                </div>
              </div>
              <div className="dp-status-strip">
                {statusChips.map((chip, i) => (
                  <div key={i} className="dp-status-chip">
                    <span className="dp-status-dot" style={{ background: chip.c, boxShadow: `0 0 10px ${chip.c}` }} />
                    <div>
                      <div className="dp-status-k">{chip.k}</div>
                      <div className="dp-status-v">{chip.v}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── AI COACH ── */}
            <div className="dp-section-sep dp-reveal dp-rev-1">
              <div style={{ position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(55% 70% at -8% -20%,rgba(212,175,55,.06) 0%,transparent 60%)', pointerEvents: 'none' }} />
                <div style={{ position: 'relative' }}>
                  <div className="dp-coach-head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                      <span className="dp-coach-avatar">◈</span>
                      <div className="dp-coach-title-wrap">
                        <span className="dp-coach-title">{s.aiCoach}</span>
                        <span className="dp-coach-status">
                          <span className="dp-pulse-dot sm green" />
                          <span className="dp-coach-status-text">{isEmpty ? s.coachStatusEmpty : s.coachStatus}</span>
                        </span>
                      </div>
                    </div>
                    {!isEmpty && (
                      <button className="dp-ghost-btn" onClick={() => setShowPrevDiscoveries(v => !v)}>
                        {isRTL ? 'תובנות קודמות' : 'View Previous Insights'} {isRTL ? '←' : '→'}
                      </button>
                    )}
                  </div>
                  <div className="dp-coach-body">
                    {isEmpty ? (
                      /* ── Empty state: welcome message ── */
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <div className="dp-coach-focus-label">{s.coachWelcomeTitle}</div>
                          <p className="dp-coach-focus-text">{s.coachWelcomeText}</p>
                        </div>
                        <div className="dp-coach-insights">
                          {([s.cEvidenceK, s.cConfidenceK, s.cActionK] as const).map((label, i) => {
                            const m = COACH_META[i];
                            return (
                              <div key={i} className="dp-coach-item">
                                <span className="dp-coach-item-icon" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', color: 'var(--w30)' }}>{m.icon}</span>
                                <div>
                                  <div className="dp-coach-item-k" style={{ color: 'var(--w30)' }}>{label}</div>
                                  <p className="dp-coach-item-text" style={{ color: 'var(--w30)' }}>—</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      /* ── Has trades: today's single strongest discovery ── */
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <div className="dp-coach-focus-label">{isRTL ? "הגילוי של היום" : "TODAY'S DISCOVERY"}</div>
                          {discoveryLoading
                            ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                <TypingDots />
                                <span className="dp-coach-focus-text" style={{ color: 'var(--w30)', margin: 0 }}>{isRTL ? 'מנתח את היומן שלך...' : 'Analyzing your journal...'}</span>
                              </div>
                            : discovery
                              ? <InsightText text={discovery.title} className="dp-coach-focus-text" />
                              : <p className="dp-coach-focus-text" style={{ color: 'var(--w30)' }}>
                                  {isRTL
                                    ? 'אין עדיין מספיק נתונים היסטוריים כדי לייצר תובנה ברמת ביטחון גבוהה.'
                                    : 'Not enough historical data yet to generate a high-confidence insight.'}
                                </p>
                          }
                        </div>
                        {/* Right column — Evidence, Confidence, Action */}
                        <div className="dp-coach-insights">
                          {discoveryLoading
                            ? ([isRTL ? 'ראיות' : 'EVIDENCE', isRTL ? 'רמת ביטחון' : 'CONFIDENCE', isRTL ? 'פעולה' : 'ACTION'] as const).map((label, i) => (
                                <div key={i} className="dp-coach-item">
                                  <span className="dp-coach-item-icon" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', color: 'var(--w30)' }}>◈</span>
                                  <div>
                                    <div className="dp-coach-item-k" style={{ color: 'var(--w30)' }}>{label}</div>
                                    <p className="dp-coach-item-text" style={{ color: 'var(--w30)' }}>...</p>
                                  </div>
                                </div>
                              ))
                            : discovery && (() => {
                                const cm = CONF_META[discovery.confidenceLevel];
                                const confLabel = { high: { he: 'גבוהה', en: 'High' }, medium: { he: 'בינונית', en: 'Medium' }, low: { he: 'נמוכה', en: 'Low' } }[discovery.confidenceLevel];
                                return (
                                  <>
                                    <div className="dp-coach-item">
                                      <span className="dp-coach-item-icon" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', color: 'var(--w55)' }}>◈</span>
                                      <div>
                                        <div className="dp-coach-item-k" style={{ color: 'var(--w55)' }}>{isRTL ? 'ראיות' : 'EVIDENCE'}</div>
                                        <InsightText text={discovery.evidence} className="dp-coach-item-text" />
                                      </div>
                                    </div>
                                    <div className="dp-coach-item">
                                      <span className="dp-coach-item-icon" style={{ background: cm.bg, border: `1px solid ${cm.bd}`, color: cm.fg }}>{cm.icon}</span>
                                      <div>
                                        <div className="dp-coach-item-k" style={{ color: cm.fg }}>{isRTL ? 'רמת ביטחון' : 'CONFIDENCE'}</div>
                                        <p className="dp-coach-item-text">{isRTL ? confLabel.he : confLabel.en} · {discovery.sampleSize} {isRTL ? 'עסקאות' : 'trades'}</p>
                                      </div>
                                    </div>
                                    <div className="dp-coach-item">
                                      <span className="dp-coach-item-icon" style={{ background: 'var(--gold-08)', border: '1px solid var(--gold-20)', color: 'var(--gold)' }}>→</span>
                                      <div>
                                        <div className="dp-coach-item-k" style={{ color: 'var(--gold)' }}>{isRTL ? 'פעולה' : 'ACTION'}</div>
                                        <InsightText text={discovery.action} className="dp-coach-item-text" />
                                      </div>
                                    </div>
                                  </>
                                );
                              })()
                          }
                        </div>
                      </>
                    )}
                  </div>
                  {showPrevDiscoveries && !isEmpty && (
                    <div style={{ marginTop: 4, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,.05)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {discoveryHistory.length === 0 ? (
                        <p style={{ fontFamily: 'var(--ff-mono)', fontSize: 11, color: 'var(--w30)' }}>{isRTL ? 'אין עדיין תובנות קודמות' : 'No previous insights yet'}</p>
                      ) : (
                        discoveryHistory.map(h => (
                          <div key={h.date} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                            <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 9, color: 'var(--w30)', whiteSpace: 'nowrap' }} dir="ltr">{h.date}</span>
                            <InsightText text={h.discovery.title} className="dp-coach-item-text" />
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  <div className="dp-coach-disc" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <span>{s.coachDisc}</span>
                    {discoveryUpdatedAt && !isEmpty && (
                      <span style={{ color: 'var(--w30)', whiteSpace: 'nowrap' }} dir="ltr">{isRTL ? 'עדכון אחרון' : 'Last updated'}: {discoveryUpdatedAt}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── PERFORMANCE ── */}
            <div className="dp-section-sep dp-reveal dp-rev-2">
              <div className="dp-perf-head">
                <span className="dp-perf-label">{s.perf}</span>
                {!isEmpty && <span className="dp-perf-hint">{s.perfHint}</span>}
                <span className="dp-perf-spacer" />
                {isEmpty
                  ? <span className="dp-perf-disclaimer" style={{ color: 'var(--w40)' }}>{s.emptyPerfTitle}</span>
                  : <span className="dp-perf-disclaimer">{s.disclaimer}</span>
                }
              </div>
              {isEmpty ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '56px 0 48px', gap: 18 }}>
                  <span style={{ fontSize: 38, color: 'var(--gold)', opacity: 0.35 }}>◈</span>
                  <div style={{ fontFamily: 'var(--ff-serif)', fontSize: 22, fontWeight: 700, color: 'var(--w55)', textAlign: 'center' }}>{s.emptyPerfTitle}</div>
                  <div style={{ fontFamily: 'var(--ff-mono)', fontSize: 12, color: 'var(--w30)', textAlign: 'center', maxWidth: 360, lineHeight: 1.7 }}>{s.emptyPerfSub}</div>
                  <Link href="/dashboard/journal" className="dp-cta-primary" style={{ maxWidth: 260, marginTop: 8 }}>
                    <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
                    <span>{s.ctaNewTrade}</span>
                  </Link>
                </div>
              ) : (
                <>
                  <div className="dp-perf-periods">
                    {periods.map((p, i) => (
                      <div key={i}>
                        <div className="dp-perf-period-label">{p.label}</div>
                        <div className="dp-perf-pnl" dir="ltr" style={{ color: p.pnl >= 0 ? 'var(--bull)' : 'var(--bear)', textAlign: isRTL ? 'right' : 'left' }}>{money(p.pnl)}</div>
                        <div className="dp-perf-sub">
                          <span dir="ltr">{p.wl}</span>
                          <span style={{ color: 'var(--border-strong)' }}>|</span>
                          <span dir="ltr" style={{ color: 'var(--w55)' }}>{p.wr}</span>
                          <span style={{ color: 'var(--border-strong)' }}>|</span>
                          <span dir="ltr" style={{ color: 'var(--gold)' }}>{p.r}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="dp-perf-sep" />
                  <div className="dp-perf-kpi">
                    <div className="dp-kpi-cell">
                      <span className="dp-kpi-label">{s.winRate}</span>
                      <span className="dp-kpi-value" dir="ltr" style={{ color: 'var(--gold)', textShadow: '0 0 22px rgba(212,175,55,.5)' }}>{anim.win.toFixed(1)}%</span>
                    </div>
                    <div className="dp-kpi-cell">
                      <span className="dp-kpi-label">{s.profitFactor}</span>
                      <span className="dp-kpi-value" dir="ltr" style={{ color: '#fff' }}>{anim.pf.toFixed(2)}</span>
                    </div>
                    <div className="dp-kpi-cell">
                      <span className="dp-kpi-label">{s.avgR}</span>
                      <span className="dp-kpi-value" dir="ltr" style={{ color: 'var(--bull)' }}>+{anim.avgr.toFixed(2)}R</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* ── TOOLS ── */}
            <div className="dp-section-sep dp-reveal dp-rev-3">
              <div className="dp-tools-grid">

                {/* Plan */}
                <div className="panel panel-pad">
                  <div className="dp-plan-head">
                    <span className="dp-plan-title">{s.planK}</span>
                    <span className="dp-plan-status" style={{ color: justSaved ? 'var(--bull)' : 'var(--gold)' }}>
                      {justSaved ? s.pSavedK + ' ✓' : planDirty ? s.pDirtyK : ''}
                    </span>
                  </div>
                  <div className="dp-plan-fields">
                    <div>
                      <div className="dp-field-label">{s.pGoalK}</div>
                      <input className="dp-field-input" value={goal} onChange={e => setGoal(e.target.value)} placeholder={s.pGoalPh} />
                    </div>
                    <div className="dp-plan-grid">
                      <div>
                        <div className="dp-field-label">{s.pBiasK}</div>
                        <div className="dp-bias-row">
                          {(['bull', 'neutral', 'bear'] as const).map(k => (
                            <button key={k} className={`dp-bias-btn${bias === k ? ' sel-' + k : ''}`} onClick={() => setBias(k)}>
                              {k === 'bull' ? s.biasBull : k === 'bear' ? s.biasBear : s.biasNeutral}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="dp-field-label">{s.pMaxK}</div>
                        <div className="dp-max-stepper">
                          <button className="dp-stepper-btn" onClick={() => setMaxTrades(m => Math.max(1, m - 1))}>−</button>
                          <span className="dp-stepper-value">{maxTrades}</span>
                          <button className="dp-stepper-btn" onClick={() => setMaxTrades(m => Math.min(20, m + 1))}>+</button>
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="dp-field-label">{s.pNoteK}</div>
                      <input className="dp-field-input" value={note} onChange={e => setNote(e.target.value)} placeholder={s.pNotePh} />
                    </div>
                    <button className={saveBtnClass} onClick={handleSavePlan}>{saveBtnText}</button>
                  </div>
                </div>

                {/* Calculator */}
                <div className="panel panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div className="dp-calc-title">{s.calcK}</div>
                  <div>
                    <div className="dp-field-label">{s.asset}</div>
                    <div className="dp-seg-grid-2">
                      {(['ES', 'NQ'] as AssetKey[]).map(k => (
                        <button key={k} className={`dp-seg-btn${asset === k ? ' active' : ''}`} onClick={() => setAsset(k)}>{k} · {SPEC[k].tag}</button>
                      ))}
                    </div>
                  </div>
                  <div className="dp-inputs-2">
                    <div>
                      <div className="dp-field-label">{s.balance}</div>
                      <input className="dp-calc-input" dir="ltr" inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)} />
                    </div>
                    <div>
                      <div className="dp-field-label">{s.stop}</div>
                      <input className="dp-calc-input" dir="ltr" inputMode="decimal" value={stop} onChange={e => setStop(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <div className="dp-field-label">{s.risk}</div>
                    <div className="dp-seg-grid-4">
                      {RISK_PRESETS.map(p => (
                        <button key={p} className={`dp-seg-btn${num(risk) === p ? ' active' : ''}`} onClick={() => setRisk(String(p))}>{p}%</button>
                      ))}
                    </div>
                  </div>
                  <div className="dp-cash-sep">
                    <div className="dp-cash-label">{s.cashRisk}</div>
                    <div className="dp-cash-value" dir="ltr" style={{ textAlign: isRTL ? 'right' : 'left' }}>{cashStr}</div>
                    <div className="dp-contracts">
                      <div className="dp-contract-cell">
                        <div className="dp-contract-label">{s.standard} · {spec.std}</div>
                        <div className="dp-contract-value" dir="ltr" style={{ color: '#fff' }}>{stdContracts}</div>
                      </div>
                      <div className="dp-contract-cell">
                        <div className="dp-contract-label">{s.micro} · {spec.micro}</div>
                        <div className="dp-contract-value" dir="ltr" style={{ color: 'var(--gold)' }}>{microContracts}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reminders */}
              <div style={{ marginTop: 50, paddingTop: 44, borderTop: '1px solid var(--w06)' }}>
                <div className="dp-reminders-head">
                  <span className="dp-reminders-label">{s.remindersK}</span>
                  <span className="dp-reminders-sep" />
                </div>
                <div className="dp-reminders-grid">
                  {reminders.map(r => (
                    <div key={r.id} className={`dp-reminder-chip${r.done ? ' done' : ''}`} onClick={() => toggleReminder(r.id)}>
                      <span className="dp-reminder-box">
                        <span className="dp-reminder-check">{r.done ? '✓' : ''}</span>
                      </span>
                      <span className="dp-reminder-text">{r.text}</span>
                      <span className="dp-reminder-del" onClick={e => { e.stopPropagation(); deleteReminder(r.id); }}>×</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ════ VARIATION B — BRIEF ════ */}
        <div className={`dp-content dp-content-brief${variation === 'B' ? ' active' : ''}`}>

          {/* Brief Hero */}
          <div className="dp-reveal">
            <div className="dp-brief-hero-grid">
              <div>
                <div className="dp-greet-label">{greetWord}</div>
                <h1 className="dp-brief-date">{s.heroWelcome} {displayName}</h1>
                <div className="dp-hero-subdate">{dateStr}</div>
                <p className="dp-brief-briefing">{s.briefing}</p>
                <div className="dp-statusbar">
                  <span className="dp-statusbar-badge">
                    <span className="dp-pulse-dot" style={{ width: 6, height: 6, background: 'var(--bull)', boxShadow: '0 0 8px var(--bull)' }} />
                    <b>{s.badgeAccountActive}</b>
                  </span>
                  <span className="dp-statusbar-sep" />
                  <Tooltip text={s.badgeDisciplineTip}>
                    <span className="dp-statusbar-badge" style={{ cursor: 'default' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', boxShadow: '0 0 8px var(--gold)' }} />
                      {s.badgeDisciplineK}: <b>{disciplineScore !== null ? disciplineScore + '%' : s.badgeDisciplineEmpty}</b>
                    </span>
                  </Tooltip>
                </div>
                <div className="dp-sessions">
                  {SESS.map((sess, i) => (
                    <div key={sess.key} className={`dp-session-chip${i === activeSessionIdx ? ' active' : ''}`}>
                      <span className={`dp-session-dot${i === activeSessionIdx ? ' dp-pulse-dot' : ''}`} />
                      <span className="dp-session-label">{sess[L]}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="dp-bias-card">
                  <div className="dp-bias-card-symbol">ES · NQ</div>
                  <div className={`dp-bias-verdict ${toneMap[savedBias] || 'neutral'}`}>{verdictMap[savedBias] || 'NEUTRAL'}</div>
                  <div className="dp-bias-rows">
                    <div className="dp-bias-row-item">
                      <span className="dp-bias-row-key">{s.rTrend}</span>
                      <span className={`dp-bias-row-val ${toneMap[savedBias] || 'gold'}`}>{trendMap[savedBias] || s.biasNeutral}</span>
                    </div>
                    <div className="dp-bias-row-item">
                      <span className="dp-bias-row-key">{s.rSession}</span>
                      <span className="dp-bias-row-val gold">{activeSessionIdx >= 0 ? SESS[activeSessionIdx][L] : s.noSession}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Performance Ribbon */}
          <div className="dp-reveal dp-rev-1">
            <div className="dp-perf-ribbon">
              <div className="dp-perf-ribbon-glow" />
              <div className="dp-ribbon-grid">
                {periods.map((p, i) => (
                  <div key={i} className="dp-ribbon-cell">
                    <div className="dp-ribbon-label">{p.label}</div>
                    <div className="dp-ribbon-pnl" dir="ltr" style={{
                      color: p.pnl >= 0 ? 'var(--bull)' : 'var(--bear)',
                      textShadow: p.pnl >= 0 ? '0 0 34px rgba(111,165,128,.35)' : '0 0 34px rgba(201,128,128,.35)',
                      textAlign: isRTL ? 'right' : 'left',
                    }}>{money(p.pnl)}</div>
                    <div className="dp-ribbon-sub">{p.wl} · {p.wr} · {p.r}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* KPI Trio */}
          <div className="dp-reveal dp-rev-2">
            <div className="dp-kpi-trio">
              <div className="dp-kpi-card">
                <div className="dp-kpi-card-label">{s.winRate}</div>
                <div className="dp-kpi-card-value" style={{ color: 'var(--gold)', textShadow: '0 0 22px rgba(212,175,55,.45)' }}>{anim.win.toFixed(1)}%</div>
              </div>
              <div className="dp-kpi-card">
                <div className="dp-kpi-card-label">{s.profitFactor}</div>
                <div className="dp-kpi-card-value" style={{ color: '#fff' }}>{anim.pf.toFixed(2)}</div>
              </div>
              <div className="dp-kpi-card">
                <div className="dp-kpi-card-label">{s.avgR}</div>
                <div className="dp-kpi-card-value" style={{ color: 'var(--bull)' }}>+{anim.avgr.toFixed(2)}R</div>
              </div>
            </div>
          </div>

          {/* Focus */}
          <div className="dp-reveal dp-rev-3">
            <div className="dp-brief-focus-card" style={{ maxWidth: 520 }}>
              <div className="dp-brief-focus-head">
                <span className="dp-brief-focus-title">{s.focusK}</span>
                {focusSaved && <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: 'var(--bull)' }}>{isRTL ? 'נשמר ✓' : 'SAVED ✓'}</span>}
              </div>
              <textarea className="dp-brief-plan-ta" value={focus} onChange={e => setFocus(e.target.value)} placeholder={isRTL ? 'מה אתה רוצה לשים עליו דגש היום?' : 'What do you want to focus on today?'} />
              <button onClick={handleSaveFocus} style={{ marginTop: 8, fontFamily: 'var(--ff-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', background: 'rgba(212,175,55,.1)', border: '1px solid rgba(212,175,55,.3)', color: 'var(--gold)', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', width: '100%' }}>
                {isRTL ? 'שמור פוקוס' : 'SAVE FOCUS'}
              </button>
            </div>
          </div>

          {/* Calculator + Reminders */}
          <div className="dp-reveal dp-rev-4">
            <div className="dp-brief-bottom-grid">
              <div className="dp-brief-calc-wrap">
                <div className="dp-brief-calc-inner">
                  <div className="dp-brief-calc-left">
                    <span className="dp-calc-title" style={{ fontSize: 11, marginBottom: 0 }}>{s.calcK}</span>
                    <div>
                      <div className="dp-field-label">{s.asset}</div>
                      <div className="dp-seg-grid-2">
                        {(['ES', 'NQ'] as AssetKey[]).map(k => (
                          <button key={k} className={`dp-seg-btn${asset === k ? ' active' : ''}`} onClick={() => setAsset(k)}>{k} · {SPEC[k].tag}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="dp-field-label">{s.balance}</div>
                      <input className="dp-calc-input" dir="ltr" inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)} />
                    </div>
                    <div>
                      <div className="dp-field-label">{s.risk}</div>
                      <div className="dp-seg-grid-4">
                        {RISK_PRESETS.map(p => (
                          <button key={p} className={`dp-seg-btn${num(risk) === p ? ' active' : ''}`} onClick={() => setRisk(String(p))}>{p}%</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="dp-field-label">{s.stop}</div>
                      <input className="dp-calc-input" dir="ltr" inputMode="decimal" value={stop} onChange={e => setStop(e.target.value)} />
                    </div>
                  </div>
                  <div className="dp-brief-calc-right">
                    <div className="dp-cash-label">{s.cashRisk}</div>
                    <div className="dp-cash-value" dir="ltr" style={{ fontSize: 32, textAlign: isRTL ? 'right' : 'left' }}>{cashStr}</div>
                    <div className="dp-contracts" style={{ marginTop: 'auto', borderRadius: 4 }}>
                      <div className="dp-contract-cell">
                        <div className="dp-contract-label">{s.standard} · {spec.std}</div>
                        <div className="dp-contract-value" dir="ltr" style={{ color: '#fff' }}>{stdContracts}</div>
                      </div>
                      <div className="dp-contract-cell">
                        <div className="dp-contract-label">{s.micro} · {spec.micro}</div>
                        <div className="dp-contract-value" dir="ltr" style={{ color: 'var(--gold)' }}>{microContracts}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="dp-brief-reminders">
                <div className="dp-rem-title">{s.remindersK}</div>
                <div>
                  {reminders.map(r => (
                    <div key={r.id} className={`dp-rem-row${r.done ? ' done' : ''}`} onClick={() => toggleReminder(r.id)}>
                      <span className="dp-rem-box">
                        <span className="dp-reminder-check" style={{ color: '#000', fontSize: 11, fontWeight: 900 }}>{r.done ? '✓' : ''}</span>
                      </span>
                      <span className="dp-rem-text">{r.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
