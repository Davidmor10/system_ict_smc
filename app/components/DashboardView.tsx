'use client';

import './dp.css';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '../hooks/useLanguage';
import { loadTrades } from '../lib/journal';

const CLERK_ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/* ── Constants ──────────────────────────────────────────────────── */
const SPEC = {
  ES: { std: 'ES', micro: 'MES', ptStd: 50, ptMicro: 5, tag: 'S&P' },
  NQ: { std: 'NQ', micro: 'MNQ', ptStd: 20, ptMicro: 2, tag: 'NDX' },
} as const;
type AssetKey = keyof typeof SPEC;
const RISK_PRESETS = [0.25, 0.5, 1, 2] as const;

const SESS = [
  { key: 'asia',   he: 'אסיה',        en: 'ASIA',   start: 2,  end: 7  },
  { key: 'london', he: 'לונדון',      en: 'LONDON', start: 9,  end: 12 },
  { key: 'nyam',   he: 'ניו יורק AM', en: 'NY AM',  start: 16, end: 18 },
  { key: 'nypm',   he: 'ניו יורק PM', en: 'NY PM',  start: 20, end: 23 },
] as const;

interface AiInsight { type: string; tag_he: string; tag_en: string; text: string; }

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
    aiK: 'תובנות AI אחרונות', aiAll: 'כל התובנות',
    calcK: 'מחשבון סיכון', asset: 'נכס', balance: 'הון בחשבון', risk: 'סיכון',
    stop: 'סטופ · נקודות', cashRisk: 'סכום בסיכון', standard: 'סטנדרט', micro: 'מיקרו',
    remindersK: 'תזכורות אישיות',
    defaultReminders: ['ללא עסקאות לפני פתיחת לונדון','מקסימום 2 עסקאות ביום','עצור את המסחר אחרי יום של 2R הפסד','צלם מסך לכל כניסה'],
    accBalance: 'הון בחשבון', accToday: 'P&L היום', accRisk: 'סיכון לעסקה',
    ctaNewTrade: 'תיעוד עסקה חדשה', ctaJournal: 'פתח יומן מסחר',
    statusReady: 'מוכן למסחר',
    aiCoach: 'מאמן ה-AI', coachStatus: 'מבוסס על היומן שלך',
    coachFocus: 'לפי היומן שלך, חלון NY AM הניב את התוצאות הטובות ביותר. שווה לשקול לתת לו עדיפות — ההחלטה תמיד שלך.',
    coachDisc: 'התובנות מבוססות על היומן האישי שלך ואינן מהוות ייעוץ או המלצת מסחר.',
    cFocusK: 'הפוקוס של היום', cOppK: 'הזדמנות', cWarnK: 'אזהרה', cPatK: 'תבנית אחרונה',
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
    emptyPerfSub: 'הוסף את העסקה הראשונה שלך כדי לצפות בנתוני הביצועים שלך.',
    emptyCoachOpp: '—', emptyCoachWarn: '—', emptyCoachPat: '—',
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
    aiK: 'LATEST AI INSIGHTS', aiAll: 'ALL INSIGHTS',
    calcK: 'RISK CALCULATOR', asset: 'ASSET', balance: 'ACCOUNT BALANCE', risk: 'RISK',
    stop: 'STOP · POINTS', cashRisk: 'CASH AT RISK', standard: 'STANDARD', micro: 'MICRO',
    remindersK: 'PERSONAL REMINDERS',
    defaultReminders: ['No trades before London open','Max 2 trades per day','Stop trading after a -2R day','Screenshot every entry'],
    accBalance: 'ACCOUNT BALANCE', accToday: "TODAY'S P&L", accRisk: 'RISK / TRADE',
    ctaNewTrade: 'Log New Trade', ctaJournal: 'Open Trade Journal',
    statusReady: 'READY TO TRADE',
    aiCoach: 'AI COACH', coachStatus: 'Based on your journal',
    coachFocus: 'Based on your journal, the NY AM window has produced your best results. It may be worth prioritizing it — the decision is always yours.',
    coachDisc: 'Insights are based on your own journal and are not financial or trading advice.',
    cFocusK: "TODAY'S FOCUS", cOppK: 'OPPORTUNITY', cWarnK: 'WARNING', cPatK: 'LAST PATTERN',
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
    emptyPerfSub: 'Add your first trade to start seeing your performance data.',
    emptyCoachOpp: '—', emptyCoachWarn: '—', emptyCoachPat: '—',
  },
} as const;

/* ── Types ──────────────────────────────────────────────────────── */
interface Reminder { id: string; text: string; done: boolean; }
type Lang = 'he' | 'en';

/* ── Helpers ────────────────────────────────────────────────────── */
const todayKey = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? n : 0; };
const money = (n: number) => (n >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');

function getIdtHour() {
  const idtDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  return idtDate.getHours() + idtDate.getMinutes() / 60;
}
function getActiveSession() {
  const hf = getIdtHour();
  return SESS.findIndex(s => hf >= s.start && hf < s.end);
}

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
  const [aiInsights, setAiInsights] = useState<AiInsight[]>([]);
  const [aiLoading,  setAiLoading]  = useState(false);
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

      const cachedAi = localStorage.getItem('onyx_ai_' + todayKey());
      if (cachedAi) { try { setAiInsights(JSON.parse(cachedAi)); } catch {} }

      const t = loadTrades();
      setTrades(t);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Fetch AI insights when trades are loaded ───────────────── */
  useEffect(() => {
    if (trades.length < 3) { setAiInsights([]); return; }
    const cacheKey = 'onyx_ai_' + todayKey();
    const cached = localStorage.getItem(cacheKey);
    if (cached) { try { setAiInsights(JSON.parse(cached)); return; } catch {} }
    setAiLoading(true);
    fetch('/api/ai/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trades, lang: L }),
    })
      .then(r => r.json())
      .then(({ insights }) => {
        if (Array.isArray(insights) && insights.length) {
          setAiInsights(insights);
          try { localStorage.setItem(cacheKey, JSON.stringify(insights)); } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setAiLoading(false));
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
  const activeSessionIdx = getActiveSession();
  const now     = new Date();
  const idtDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const h       = idtDate.getHours();
  const greetWord = h < 12 ? s.greetMorning : h < 17 ? s.greetAfternoon : s.greetEvening;
  const displayName = userName || (isRTL ? 'אורח' : 'Trader');
  const greet   = greetWord + ' ' + displayName;
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
  const statusChips = [
    { k: s.stTradingK, v: s.stTradingV, c: 'var(--bull)' },
    { k: s.stRiskK,    v: s.stRiskV,    c: 'var(--bull)' },
    { k: s.stDiscK,    v: isEmpty ? s.stDiscVEmpty : s.stDiscV,  c: isEmpty ? 'var(--w40)' : 'var(--gold)' },
    { k: s.stHealthK,  v: s.stHealthV,  c: 'var(--bull)' },
  ];
  const coachKeys = [s.cOppK, s.cWarnK, s.cPatK] as const;
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
                    <span className="dp-greet-label">{greet}</span>
                    <span className="dp-status-pill">
                      <span className="dp-pulse-dot" style={{ width: 6, height: 6 }} />
                      <span className="dp-status-pill-text">{s.statusReady}</span>
                    </span>
                  </div>
                  <h1 className="dp-hero-date">{dateStr}</h1>
                  <p className="dp-hero-brief">{s.briefing}</p>
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
                    <button className="dp-ghost-btn">{s.aiAll} {isRTL ? '←' : '→'}</button>
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
                          {([s.cOppK, s.cWarnK, s.cPatK] as const).map((label, i) => {
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
                      /* ── Has trades: real AI insights ── */
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <div className="dp-coach-focus-label">{s.cFocusK}</div>
                          {aiLoading
                            ? <p className="dp-coach-focus-text" style={{ color: 'var(--w30)' }}>{isRTL ? 'מנתח את היומן שלך...' : 'Analyzing your journal...'}</p>
                            : aiInsights.length > 0
                              ? <p className="dp-coach-focus-text">{aiInsights[0].text}</p>
                              : <p className="dp-coach-focus-text" style={{ color: 'var(--w30)' }}>{isRTL ? 'הוסף לפחות 3 עסקאות לקבלת ניתוח' : 'Add at least 3 trades for analysis'}</p>
                          }
                        </div>
                        {/* Right column — insights 1 & 2 only (insight 0 shown as main focus above) */}
                        <div className="dp-coach-insights">
                          {aiLoading
                            ? ([s.cWarnK, s.cPatK] as const).map((label, i) => {
                                const m = COACH_META[i + 1];
                                return (
                                  <div key={i} className="dp-coach-item">
                                    <span className="dp-coach-item-icon" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', color: 'var(--w30)' }}>{m.icon}</span>
                                    <div>
                                      <div className="dp-coach-item-k" style={{ color: 'var(--w30)' }}>{label}</div>
                                      <p className="dp-coach-item-text" style={{ color: 'var(--w30)' }}>...</p>
                                    </div>
                                  </div>
                                );
                              })
                            : aiInsights.slice(1).map((insight, i) => {
                                const m = COACH_META[i + 1] ?? COACH_META[2];
                                return (
                                  <div key={i} className="dp-coach-item">
                                    <span className="dp-coach-item-icon" style={{ background: m.bg, border: `1px solid ${m.bd}`, color: m.fg }}>{m.icon}</span>
                                    <div>
                                      <div className="dp-coach-item-k" style={{ color: m.fg }}>{L === 'he' ? insight.tag_he : insight.tag_en}</div>
                                      <p className="dp-coach-item-text">{insight.text}</p>
                                    </div>
                                  </div>
                                );
                              })
                          }
                        </div>
                      </>
                    )}
                  </div>
                  <div className="dp-coach-disc">{s.coachDisc}</div>
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
                <div className="dp-greet-label">{greet}</div>
                <h1 className="dp-brief-date">{dateStr}</h1>
                <p className="dp-brief-briefing">{s.briefing}</p>
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

          {/* Focus + AI Insights */}
          <div className="dp-reveal dp-rev-3">
            <div className="dp-brief-lower-grid">
              <div className="dp-brief-focus-card">
                <div className="dp-brief-focus-head">
                  <span className="dp-brief-focus-title">{s.focusK}</span>
                  {focusSaved && <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: 'var(--bull)' }}>{isRTL ? 'נשמר ✓' : 'SAVED ✓'}</span>}
                </div>
                <textarea className="dp-brief-plan-ta" value={focus} onChange={e => setFocus(e.target.value)} placeholder={isRTL ? 'מה אתה רוצה לשים עליו דגש היום?' : 'What do you want to focus on today?'} />
                <button onClick={handleSaveFocus} style={{ marginTop: 8, fontFamily: 'var(--ff-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', background: 'rgba(212,175,55,.1)', border: '1px solid rgba(212,175,55,.3)', color: 'var(--gold)', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', width: '100%' }}>
                  {isRTL ? 'שמור פוקוס' : 'SAVE FOCUS'}
                </button>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <span className="dp-insights-title">{s.aiK}</span>
                  <button className="dp-ghost-btn" style={{ fontSize: 10 }}>{s.aiAll} {isRTL ? '←' : '→'}</button>
                </div>
                <div className="dp-insights-list">
                  {(isEmpty || (!aiLoading && aiInsights.length === 0)) && (
                    <div className="dp-insight-card" style={{ textAlign: 'center', padding: '18px 12px', color: 'var(--w30)', fontFamily: 'var(--ff-mono)', fontSize: 11 }}>
                      {isEmpty ? (isRTL ? 'הוסף עסקאות כדי לקבל תובנות' : 'Add trades to get insights') : (isRTL ? 'הוסף לפחות 3 עסקאות' : 'Add at least 3 trades')}
                    </div>
                  )}
                  {aiLoading && [0,1,2].map(i => (
                    <div key={i} className="dp-insight-card" style={{ opacity: 0.4 }}>
                      <div className="dp-insight-head"><span className="dp-insight-tag">...</span></div>
                      <p className="dp-insight-text">{isRTL ? 'מנתח...' : 'Analyzing...'}</p>
                    </div>
                  ))}
                  {!aiLoading && aiInsights.map((x, i) => (
                    <div key={i} className="dp-insight-card">
                      <div className="dp-insight-head">
                        <span className="dp-insight-tag">{L === 'he' ? x.tag_he : x.tag_en}</span>
                      </div>
                      <p className="dp-insight-text">{x.text}</p>
                    </div>
                  ))}
                </div>
              </div>
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
