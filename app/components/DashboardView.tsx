'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { useLanguage } from '../hooks/useLanguage';
import { loadTrades, computeStats, tradePnL, todayISO } from '../lib/journal';
import type { TradeEntry, TradeStats } from '../lib/journal';
import PositionCalculator from './PositionCalculator';

// ─── Design tokens ────────────────────────────────────────────────────────────

const PANEL: React.CSSProperties = {
  background: '#0a0a0b',
  border: '1px solid #1c1c1e',
  borderRadius: '14px',
  boxShadow: '0 24px 60px -46px rgba(0,0,0,.9)',
  padding: '32px',
};
const PANEL_GOLD: React.CSSProperties = {
  ...PANEL,
  border: '1px solid rgba(212,175,55,.28)',
};
const ELEVATED: React.CSSProperties = {
  background: '#121214',
  border: '1px solid #1f1f22',
  borderRadius: '10px',
};

// ─── Israel Time ──────────────────────────────────────────────────────────────

function israelTime() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? '0', 10);
  const h = g('hour'); const m = g('minute'); const s = g('second');
  const p = (n: number) => String(n).padStart(2, '0');
  return { h, m, s, clock: `${p(h)}:${p(m)}:${p(s)}` };
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

type Session = 'asia' | 'london' | 'ny_am' | 'ny_pm' | null;
function getSession(h: number, m: number): Session {
  const t = h * 60 + m;
  if (t >= 120  && t < 420)  return 'asia';
  if (t >= 540  && t < 720)  return 'london';
  if (t >= 960  && t < 1080) return 'ny_am';
  if (t >= 1200 && t < 1380) return 'ny_pm';
  return null;
}
const SESSIONS = [
  { id: 'asia',   he: 'אסיה',   en: 'Asia',   time: '02–07' },
  { id: 'london', he: 'לונדון', en: 'London', time: '09–12' },
  { id: 'ny_am',  he: 'NY AM',  en: 'NY AM',  time: '16–18' },
  { id: 'ny_pm',  he: 'NY PM',  en: 'NY PM',  time: '20–23' },
] as const;
const SESSION_LABELS: Record<string, { en: string; he: string }> = {
  asia:   { en: 'Asia',   he: 'אסיה'   },
  london: { en: 'London', he: 'לונדון' },
  ny_am:  { en: 'NY AM',  he: 'NY AM'  },
  ny_pm:  { en: 'NY PM',  he: 'NY PM'  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtUSD = (n: number) => {
  const abs = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n));
  return n < 0 ? `-${abs}` : abs;
};
const pnlColor = (n: number) =>
  n > 0 ? '#6fa580' : n < 0 ? '#c98080' : 'rgba(255,255,255,.45)';

function weekStart() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}
function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}

// ─── Account ─────────────────────────────────────────────────────────────────

interface AccountConfig { startingCapital: number; currency: string; createdAt: string; }
const acctKey = (uid: string | null | undefined) => `onyx_account_${uid ?? 'default'}`;
function loadAccount(uid: string | null | undefined): AccountConfig | null {
  if (typeof window === 'undefined') return null;
  try { const r = localStorage.getItem(acctKey(uid)); if (r) return JSON.parse(r); } catch { /**/ }
  return null;
}
function saveAccount(uid: string | null | undefined, cfg: AccountConfig) {
  if (typeof window !== 'undefined') localStorage.setItem(acctKey(uid), JSON.stringify(cfg));
}

// ─── Account Setup Modal ──────────────────────────────────────────────────────

function AccountSetupModal({ en, uid, onDone }: { en: boolean; uid: string | null | undefined; onDone: (cfg: AccountConfig) => void }) {
  const [capital, setCapital] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'ILS' | 'EUR'>('USD');
  const [err, setErr] = useState('');

  function submit() {
    const n = parseFloat(capital.replace(/,/g, ''));
    if (!n || n <= 0) { setErr(en ? 'Please enter a valid amount > 0' : 'יש להזין סכום חוקי גדול מ-0'); return; }
    const cfg: AccountConfig = { startingCapital: n, currency, createdAt: new Date().toISOString() };
    saveAccount(uid, cfg);
    onDone(cfg);
  }

  const inputCls: string = [
    'w-full font-mono text-lg text-white placeholder-white/20 outline-none transition-colors duration-200',
    'px-4 py-3',
  ].join(' ');

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.9)', backdropFilter: 'blur(14px)' }}>
      <div style={{ ...PANEL_GOLD, padding: '40px', width: '100%', maxWidth: '380px' }} dir={en ? 'ltr' : 'rtl'}>

        <div className="flex flex-col items-center gap-3 text-center mb-8">
          <span className="font-mono text-4xl text-[#d4af37]" style={{ textShadow: '0 0 20px rgba(212,175,55,.4)' }}>◈</span>
          <h2 className="font-mono text-base font-bold uppercase tracking-[0.2em] text-white">
            {en ? 'Account Setup' : 'הגדרת חשבון'}
          </h2>
          <p className="font-mono text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,.45)' }}>
            {en
              ? 'Set your starting capital to track equity and risk correctly.'
              : 'הגדר את ההון ההתחלתי שלך כדי לעקוב אחר ה-Equity והסיכון בצורה מדויקת.'}
          </p>
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <Label>{en ? 'Starting Capital' : 'הון התחלתי'}</Label>
            <div style={{ ...ELEVATED, marginTop: '6px' }}>
              <input dir="ltr" inputMode="decimal" value={capital}
                onChange={e => { setCapital(e.target.value); setErr(''); }}
                onKeyDown={e => e.key === 'Enter' && submit()}
                placeholder={en ? 'e.g. 50000' : 'לדוגמה: 50000'}
                className={inputCls} autoFocus
                style={{ background: 'transparent', display: 'block' }}
              />
            </div>
            {err && <p className="font-mono text-xs mt-2" style={{ color: '#c98080' }}>{err}</p>}
          </div>

          <div>
            <Label>{en ? 'Currency' : 'מטבע'}</Label>
            <div className="flex gap-2 mt-1.5">
              {(['USD', 'ILS', 'EUR'] as const).map(c => (
                <button key={c} onClick={() => setCurrency(c)}
                  className="flex-1 py-2.5 font-mono text-sm font-bold uppercase tracking-[0.12em] transition-all duration-200"
                  style={{
                    ...ELEVATED,
                    borderColor: currency === c ? 'rgba(212,175,55,.5)' : '#1f1f22',
                    background: currency === c ? 'rgba(212,175,55,.08)' : '#121214',
                    color: currency === c ? '#d4af37' : 'rgba(255,255,255,.35)',
                  }}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <button onClick={submit}
            className="w-full py-3.5 font-mono text-sm font-bold uppercase tracking-[0.14em] text-black transition-all duration-200"
            style={{ background: '#d4af37', borderRadius: '10px', boxShadow: '0 0 28px rgba(212,175,55,.25)', marginTop: '8px' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 44px rgba(212,175,55,.42)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 28px rgba(212,175,55,.25)'; }}
          >
            {en ? 'Get Started' : 'התחל'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reminder ─────────────────────────────────────────────────────────────────

interface Reminder { id: string; text: string; done: boolean; }
const REM_KEY = 'onyx_dash_reminders_v2';
const DEFAULT_REMINDERS: Reminder[] = [
  { id: '1', text: 'לבדוק את הביאס לפני כניסה', done: false },
  { id: '2', text: 'לא לסחור נגד הטרנד הראשי', done: false },
  { id: '3', text: 'להגדיר סטופ לוס לפני כניסה', done: false },
  { id: '4', text: 'לרשום את העסקה מיד לאחר הסגירה', done: false },
];
function loadReminders(): Reminder[] {
  if (typeof window === 'undefined') return DEFAULT_REMINDERS;
  try { const r = localStorage.getItem(REM_KEY); if (r) return JSON.parse(r); } catch { /**/ }
  localStorage.setItem(REM_KEY, JSON.stringify(DEFAULT_REMINDERS));
  return [...DEFAULT_REMINDERS];
}
function saveReminders(items: Reminder[]) {
  if (typeof window !== 'undefined') localStorage.setItem(REM_KEY, JSON.stringify(items));
}

// ─── Daily Plan ───────────────────────────────────────────────────────────────

interface DailyPlan { goal: string; bias: 'bull' | 'bear' | 'neutral'; maxTrades: number; }
const emptyPlan = (): DailyPlan => ({ goal: '', bias: 'neutral', maxTrades: 3 });
const planKey = (d: string) => `onyx_dash_planobj_${d}`;
function loadPlan(d: string): DailyPlan {
  if (typeof window === 'undefined') return emptyPlan();
  try { const r = localStorage.getItem(planKey(d)); if (r) return { ...emptyPlan(), ...JSON.parse(r) }; } catch { /**/ }
  return emptyPlan();
}
function savePlan(d: string, p: DailyPlan) {
  if (typeof window !== 'undefined') localStorage.setItem(planKey(d), JSON.stringify(p));
}

// ─── KPI formatters — no ∞, no fabricated values ──────────────────────────────

function fmtWinRate(s: TradeStats): string {
  return s.wins + s.losses === 0 ? '—' : `${s.winRate.toFixed(1)}%`;
}
function fmtPF(s: TradeStats): string {
  return s.losses === 0 || !isFinite(s.profitFactor) ? '—' : s.profitFactor.toFixed(2);
}
function fmtAvgR(s: TradeStats): string {
  return s.wins + s.losses === 0 ? '—' : `${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R`;
}

// ─── AI insights (computed, no API) ──────────────────────────────────────────

function buildInsights(trades: TradeEntry[], en: boolean): { tag: string; tagColor: string; text: string }[] {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const out: { tag: string; tagColor: string; text: string }[] = [];

  const bySess: Record<string, TradeEntry[]> = {};
  closed.forEach(t => { const k = t.session || 'UNKNOWN'; bySess[k] = [...(bySess[k] ?? []), t]; });
  const best = Object.entries(bySess)
    .map(([s, ts]) => ({ s, wr: ts.filter(t => t.result === 'WIN').length / ts.length, n: ts.length }))
    .filter(x => x.n >= 3).sort((a, b) => b.wr - a.wr)[0];
  if (best) out.push({
    tag: en ? 'Opportunity' : 'הזדמנות', tagColor: '#6fa580',
    text: en
      ? `Your ${best.s} session shows a ${Math.round(best.wr * 100)}% win rate across ${best.n} trades. Worth focusing there.`
      : `ייתכן שכדאי לשים לב לסשן ${best.s} — ${Math.round(best.wr * 100)}% הצלחה על פני ${best.n} עסקאות.`,
  });

  const recent = [...closed].reverse().slice(0, 5);
  const streakLen = recent.findIndex(t => t.result !== recent[0]?.result);
  const streak = streakLen === -1 ? recent.length : streakLen;
  if (streak >= 3 && recent[0]?.result === 'LOSS') out.push({
    tag: en ? 'Warning' : 'אזהרה', tagColor: '#c98080',
    text: en
      ? `Consider stepping back — your last ${streak} trades were losses. Review your setup before the next entry.`
      : `אולי כדאי לעצור רגע — ${streak} עסקאות אחרונות היו הפסד. שווה לבחון את תנאי הכניסה.`,
  });
  else if (streak >= 3 && recent[0]?.result === 'WIN') out.push({
    tag: en ? 'Pattern' : 'תבנית', tagColor: '#d4af37',
    text: en
      ? `${streak}-trade winning streak. Your current process seems to be working — stay consistent.`
      : `רצף של ${streak} עסקאות מרוויחות. הגישה הנוכחית עובדת — שמור על העקביות.`,
  });

  if (closed.length >= 5) {
    const avgR = closed.reduce((s, t) => s + (t.tradeR ?? 0), 0) / closed.length;
    out.push({
      tag: en ? 'Pattern' : 'תבנית אחרונה', tagColor: 'rgba(255,255,255,.4)',
      text: en
        ? `Across ${closed.length} closed trades, avg R is ${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R. ${avgR < 0.5 ? 'Consider reviewing your exit strategy.' : 'Healthy R — keep letting winners run.'}`
        : `על פני ${closed.length} עסקאות, R ממוצע ${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R. ${avgR < 0.5 ? 'אולי כדאי לבחון אסטרטגיית יציאה.' : 'יחס R בריא — תן לרווחים לרוץ.'}`,
    });
  }

  return out.slice(0, 3);
}

// ─── UI atoms ─────────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="block font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: 'rgba(255,255,255,.45)' }}>
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <span className="font-mono text-[10px] uppercase tracking-[0.26em]" style={{ color: 'rgba(255,255,255,.45)' }}>{children}</span>
    </div>
  );
}

function InnerDivider() {
  return <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', margin: '24px 0' }} />;
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. HERO
// ──────────────────────────────────────────────────────────────────────────────

function HeroPanel({
  greeting, userName, todayFull, session, en, rtl,
  todayTrades, todayPnl, equity, currency, onEditAccount,
}: {
  greeting: string; userName: string; todayFull: string; session: Session;
  en: boolean; rtl: boolean; todayTrades: TradeEntry[]; todayPnl: number;
  equity: number; currency: string; onEditAccount: () => void;
}) {
  const todayStats = computeStats(todayTrades);
  const sym = currency === 'ILS' ? '₪' : currency === 'EUR' ? '€' : '$';
  const fmtEq = `${sym}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(equity)}`;

  return (
    <div style={PANEL}>
      {/* 2-col grid */}
      <div className="grid gap-8 mb-7" style={{ gridTemplateColumns: '1.5fr 1fr' }}>

        {/* Left: greeting, date, sessions */}
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-[13px] uppercase tracking-[0.22em] font-bold" style={{ color: '#d4af37' }}>
              {greeting} {userName}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
              style={{ border: '1px solid rgba(212,175,55,.3)', background: 'rgba(212,175,55,.06)', color: '#d4af37', borderRadius: '99px' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37] animate-pulse" />
              {en ? 'Ready to Trade' : 'מוכן למסחר'}
            </span>
          </div>

          <h1 className="leading-none font-bold text-white" style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1.75rem,3.5vw,3rem)' }}>
            {todayFull}
          </h1>

          <p className="font-mono text-sm tracking-wide" style={{ color: 'rgba(255,255,255,.45)' }}>
            {en ? 'Your daily briefing, at a glance.' : 'הסקירה היומית שלך, במבט אחד.'}
          </p>

          {/* Session chips */}
          <div className="flex items-center gap-2 flex-wrap">
            {SESSIONS.map(s => {
              const isActive = session === s.id;
              return (
                <span key={s.id} className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-all duration-250"
                  style={{
                    border: isActive ? '1px solid rgba(212,175,55,.5)' : '1px solid rgba(255,255,255,.08)',
                    background: isActive ? 'rgba(212,175,55,.08)' : 'transparent',
                    color: isActive ? '#d4af37' : 'rgba(255,255,255,.3)',
                    fontWeight: isActive ? 700 : 400,
                    borderRadius: '99px',
                  }}>
                  {en ? s.en : s.he}
                  <span className="ms-1.5 opacity-50">{s.time}</span>
                </span>
              );
            })}
            {!session && (
              <span className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,.25)' }}>
                {en ? 'No active session' : 'אין סשן פעיל'}
              </span>
            )}
          </div>
        </div>

        {/* Right: stat cells + CTA */}
        <div className="flex flex-col gap-5">
          {/* 3-cell grid — elevated */}
          <div className="grid grid-cols-3 gap-2">
            {/* Equity */}
            <div style={{ ...ELEVATED, padding: '14px 12px' }}>
              <Label>{en ? 'Account' : 'הון'}</Label>
              <span className="block font-mono text-base font-bold tabular-nums text-white mt-1.5" dir="ltr">{fmtEq}</span>
              <button onClick={onEditAccount} className="block font-mono text-[9px] uppercase tracking-[0.14em] mt-1.5 transition-colors"
                style={{ color: 'rgba(255,255,255,.25)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#d4af37'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.25)'; }}>
                {en ? 'Edit' : 'ערוך'}
              </button>
            </div>
            {/* Today P&L */}
            <div style={{ ...ELEVATED, padding: '14px 12px' }}>
              <Label>{en ? "P&L Today" : 'P&L היום'}</Label>
              <span className="block font-mono text-base font-bold tabular-nums mt-1.5" dir="ltr" style={{ color: pnlColor(todayPnl) }}>
                {todayTrades.length ? fmtUSD(todayPnl) : '$0'}
              </span>
              <span className="block font-mono text-[9px] mt-1.5" style={{ color: 'rgba(255,255,255,.25)' }}>
                {todayStats.wins}W · {todayStats.losses}L
              </span>
            </div>
            {/* Risk/trade */}
            <div style={{ ...ELEVATED, padding: '14px 12px' }}>
              <Label>{en ? 'Risk/Trade' : 'סיכון/עסקה'}</Label>
              <span className="block font-mono text-base font-bold tabular-nums mt-1.5" dir="ltr" style={{ color: '#d4af37' }}>
                {fmtUSD(equity * 0.01)}
              </span>
              <span className="block font-mono text-[9px] mt-1.5" style={{ color: 'rgba(255,255,255,.25)' }}>1%</span>
            </div>
          </div>

          {/* CTA */}
          <Link href="/dashboard/journal"
            className="block text-center font-mono text-sm font-bold uppercase tracking-[0.14em] text-black transition-all duration-250"
            style={{ background: '#d4af37', borderRadius: '10px', padding: '14px', boxShadow: '0 0 28px rgba(212,175,55,.22)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 44px rgba(212,175,55,.40)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 28px rgba(212,175,55,.22)'; (e.currentTarget as HTMLElement).style.transform = ''; }}>
            {en ? '+ Log New Trade' : '+ תיעוד עסקה חדשה'}
          </Link>

          <Link href="/dashboard/journal" className="text-center font-mono text-xs uppercase tracking-[0.18em] transition-colors"
            style={{ color: 'rgba(255,255,255,.3)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.6)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.3)'; }}>
            {en ? 'Open Trading Journal →' : '← פתח יומן מסחר'}
          </Link>
        </div>
      </div>

      {/* Status strip */}
      <InnerDivider />
      <div className="grid grid-cols-4 max-[700px]:grid-cols-2 gap-4">
        {[
          { dot: '#6fa580', label: en ? 'Trading Status' : 'סטטוס מסחר',    val: en ? 'Ready' : 'מוכן' },
          { dot: '#6fa580', label: en ? 'Risk Status' : 'סטטוס סיכון',      val: en ? 'Within limits' : 'בתוך הגבולות' },
          { dot: '#d4af37', label: en ? 'Discipline' : 'משמעת',             val: en ? `${todayStats.wins + todayStats.losses} trades today` : `${todayStats.wins + todayStats.losses} עסקאות היום` },
          { dot: '#6fa580', label: en ? 'Account Health' : 'בריאות החשבון', val: en ? 'Strong' : 'חזקה' },
        ].map(({ dot, label, val }) => (
          <div key={label} className="flex items-center gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
            <div>
              <span className="block font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,.25)' }}>{label}</span>
              <span className="block font-mono text-xs font-bold" style={{ color: 'rgba(255,255,255,.7)' }}>{val}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. AI COACH
// ──────────────────────────────────────────────────────────────────────────────

function AICoachPanel({ trades, en }: { trades: TradeEntry[]; en: boolean }) {
  const closedTrades = trades.filter(t => t.result !== 'OPEN');
  const hasData = closedTrades.length >= 3;
  const insights = hasData ? buildInsights(trades, en) : [];

  const focusText = en
    ? 'Review your most recent trades before the session opens. Look for repeated entry patterns in both winning and losing trades, and choose one specific setup to focus on today. Your edge comes from repetition.'
    : 'אולי כדאי לעבור על העסקאות האחרונות לפני פתיחת הסשן. שים לב לדפוסי הכניסה החוזרים — הן בעסקאות המרוויחות והן בהפסידות — ובחר תבנית אחת ספציפית להתמקד בה היום. היתרון שלך מגיע מחזרה עקבית.';

  return (
    <div style={PANEL_GOLD}>
      {/* Header */}
      <div className="flex items-start justify-between mb-7 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 font-mono text-base flex items-center justify-center shrink-0"
            style={{ background: 'rgba(212,175,55,.07)', border: '1px solid rgba(212,175,55,.18)', borderRadius: '10px', color: '#d4af37' }}>
            ◈
          </div>
          <div>
            <span className="block font-mono text-[11px] uppercase tracking-[0.24em]" style={{ color: '#d4af37' }}>
              {en ? 'AI Coach' : 'מאמן ה-AI'}
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#6fa580] animate-pulse" />
              <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'rgba(255,255,255,.3)' }}>
                {en ? 'Based on your journal' : 'מבוסס על היומן שלך'}
              </span>
            </div>
          </div>
        </div>
        <Link href="/dashboard/analytics" className="font-mono text-[10px] uppercase tracking-[0.18em] transition-colors"
          style={{ color: 'rgba(255,255,255,.3)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.6)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.3)'; }}>
          {en ? 'View All →' : '← הצג הכל'}
        </Link>
      </div>

      {!hasData ? (
        /* Onboarding empty state — inside same Panel, centered, no extra box */
        <div className="flex flex-col items-center gap-4 text-center py-12" dir={en ? 'ltr' : 'rtl'}>
          <span className="font-mono text-4xl" style={{ color: 'rgba(212,175,55,.2)' }}>◈</span>
          <p className="font-mono text-sm leading-relaxed max-w-sm" style={{ color: 'rgba(255,255,255,.5)' }}>
            {en
              ? 'Welcome to Onyx. Start logging trades and the coach will identify your patterns — when you win, where you lose, and what to improve.'
              : 'ברוך הבא ל-Onyx. התחל לתעד עסקאות והמאמן יזהה עבורך דפוסים — מתי אתה מרוויח, איפה אתה מפסיד, ומה לשפר.'}
          </p>
          <p className="font-mono text-[10px] leading-relaxed max-w-sm" style={{ color: 'rgba(255,255,255,.25)' }}>
            {en
              ? 'Insights appear after 3+ closed trades. Based solely on your journal — not investment advice.'
              : 'תובנות יופיעו לאחר 3+ עסקאות סגורות. מבוסס אך ורק על היומן שלך — אינו ייעוץ השקעות.'}
          </p>
        </div>
      ) : (
        /* 2-col layout */
        <div className="grid grid-cols-[1.4fr_1fr] max-[800px]:grid-cols-1 gap-8">
          {/* Left: focus */}
          <div>
            <Label>{en ? "Today's Focus" : 'הפוקוס של היום'}</Label>
            <p className="mt-3 leading-[1.72]" dir={en ? 'ltr' : 'rtl'}
              style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(.95rem,1.4vw,1.1rem)', color: 'rgba(255,255,255,.65)' }}>
              {focusText}
            </p>
          </div>
          {/* Right: insights */}
          <div className="flex flex-col gap-5">
            {insights.map(({ tag, tagColor, text }) => (
              <div key={tag} className="flex gap-3">
                <div className="w-5 h-5 font-mono text-[9px] flex items-center justify-center shrink-0 mt-0.5"
                  style={{
                    background: `color-mix(in srgb, ${tagColor} 10%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${tagColor} 22%, transparent)`,
                    borderRadius: '6px', color: tagColor,
                  }}>◈</div>
                <div>
                  <span className="block font-mono text-[9px] uppercase tracking-[0.2em] mb-1.5" style={{ color: tagColor }}>{tag}</span>
                  <p className="font-mono text-xs leading-relaxed" dir={en ? 'ltr' : 'rtl'} style={{ color: 'rgba(255,255,255,.5)' }}>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasData && (
        <div className="mt-7 pt-5 font-mono text-[10px] leading-relaxed" dir={en ? 'ltr' : 'rtl'}
          style={{ borderTop: '1px solid rgba(255,255,255,.06)', color: 'rgba(255,255,255,.22)' }}>
          {en
            ? 'Insights are based solely on your personal journal data and do not constitute trading advice or investment recommendations.'
            : 'התובנות מבוססות אך ורק על נתוני היומן האישי שלך ואינן מהוות ייעוץ מסחרי או המלצת השקעה.'}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. PERFORMANCE
// ──────────────────────────────────────────────────────────────────────────────

function PerformancePanel({ en, today, week, month, allStats }: {
  en: boolean;
  today: { pnl: number; stats: TradeStats; count: number };
  week:  { pnl: number; stats: TradeStats; count: number };
  month: { pnl: number; stats: TradeStats; count: number };
  allStats: TradeStats;
}) {
  const noTrades = allStats.count === 0;

  return (
    <div style={PANEL}>
      <SectionTitle>{en ? 'Performance' : 'ביצועים'}</SectionTitle>

      {noTrades ? (
        <div className="flex flex-col items-center gap-4 text-center py-12">
          <span className="font-mono text-4xl" style={{ color: 'rgba(255,255,255,.1)' }}>◈</span>
          <p className="font-mono text-sm" style={{ color: 'rgba(255,255,255,.45)' }}>
            {en ? 'No performance data yet' : 'אין עדיין נתוני ביצועים'}
          </p>
          <p className="font-mono text-xs leading-relaxed max-w-xs" dir={en ? 'ltr' : 'rtl'} style={{ color: 'rgba(255,255,255,.28)' }}>
            {en
              ? 'Log your first trade to start tracking performance across today, this week, and this month.'
              : 'תעד את העסקה הראשונה שלך כדי להתחיל לעקוב אחר הביצועים — היום, השבוע, והחודש.'}
          </p>
          <Link href="/dashboard/journal"
            className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-black transition-all duration-200"
            style={{ background: '#d4af37', borderRadius: '8px', padding: '10px 24px', boxShadow: '0 0 20px rgba(212,175,55,.18)' }}>
            {en ? '+ Log New Trade' : '+ תיעוד עסקה חדשה'}
          </Link>
        </div>
      ) : (
        <>
          {/* P&L periods */}
          <div className="grid grid-cols-3 gap-8 max-[600px]:grid-cols-1">
            {[
              { label: en ? 'Today' : 'היום',       ...today },
              { label: en ? 'This Week' : 'השבוע',  ...week  },
              { label: en ? 'This Month' : 'החודש', ...month },
            ].map(({ label, pnl, stats, count }) => (
              <div key={label}>
                <Label>{label}</Label>
                <div className="font-bold tabular-nums mt-2 mb-2 leading-none"
                  style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1.8rem,3vw,2.75rem)', color: count ? pnlColor(pnl) : 'rgba(255,255,255,.2)' }}
                  dir="ltr">
                  {count ? fmtUSD(pnl) : '$0'}
                </div>
                <div className="flex items-center gap-3 font-mono text-[10px]" style={{ color: 'rgba(255,255,255,.35)' }}>
                  <span dir="ltr">{fmtAvgR(stats)}</span>
                  <span className="w-px h-3" style={{ background: 'rgba(255,255,255,.1)' }} />
                  <span dir="ltr">{fmtWinRate(stats)}</span>
                  <span className="w-px h-3" style={{ background: 'rgba(255,255,255,.1)' }} />
                  <span dir="ltr">{stats.wins}W / {stats.losses}L</span>
                </div>
              </div>
            ))}
          </div>

          <InnerDivider />

          {/* KPI row */}
          <div className="grid grid-cols-3 max-[600px]:grid-cols-1 gap-6">
            {[
              { label: en ? 'Win Rate' : 'אחוז הצלחה', value: fmtWinRate(allStats), gold: true, sub: `${allStats.wins + allStats.losses} ${en ? 'closed' : 'סגורות'}` },
              { label: en ? 'Profit Factor' : 'פרופיט פקטור', value: fmtPF(allStats), gold: false, sub: en ? 'gross W / gross L' : 'רווח / הפסד גולמי' },
              { label: en ? 'Avg R' : 'R ממוצע', value: fmtAvgR(allStats), gold: false, sub: en ? 'across all trades' : 'כל העסקאות' },
            ].map(({ label, value, gold, sub }) => (
              <div key={label}>
                <Label>{label}</Label>
                <span className="block font-mono text-2xl font-bold tabular-nums mt-2" dir="ltr"
                  style={gold ? { color: '#d4af37', textShadow: '0 0 18px rgba(212,175,55,.35)' } : { color: 'rgba(255,255,255,.8)' }}>
                  {value}
                </span>
                <span className="block font-mono text-[10px] mt-1" style={{ color: 'rgba(255,255,255,.25)' }}>{sub}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 4a. TRADING PLAN (Panel, no inner wrapper)
// ──────────────────────────────────────────────────────────────────────────────

function TradingPlanPanel({ en, plan, reminder, setReminder, dirty, saved, update, onSave }: {
  en: boolean; plan: DailyPlan; reminder: string; setReminder: (v: string) => void;
  dirty: boolean; saved: boolean;
  update: <K extends keyof DailyPlan>(k: K, v: DailyPlan[K]) => void;
  onSave: () => void;
}) {
  const inputStyle: React.CSSProperties = {
    ...ELEVATED,
    width: '100%', padding: '10px 14px',
    fontFamily: 'var(--font-mono)', fontSize: '14px', color: '#fff',
    outline: 'none', display: 'block',
    transition: 'border-color 200ms',
  };

  return (
    <div style={PANEL}>
      <div className="flex items-center justify-between mb-6">
        <SectionTitle>{en ? "Today's Trading Plan" : 'תוכנית המסחר להיום'}</SectionTitle>
        <div style={{ marginBottom: '24px' }}>
          {dirty && !saved && (
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] px-2.5 py-1"
              style={{ border: '1px solid rgba(212,175,55,.35)', color: '#d4af37', background: 'rgba(212,175,55,.06)', borderRadius: '99px' }}>
              {en ? 'Unsaved' : 'לא נשמר'}
            </span>
          )}
          {saved && <span className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: '#6fa580' }}>{en ? 'Saved ✓' : '✓ נשמר'}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div>
          <Label>{en ? 'Goal for today' : 'המטרה של היום'}</Label>
          <input value={plan.goal} onChange={e => update('goal', e.target.value)}
            placeholder={en ? 'e.g. Follow the plan, no revenge trades' : 'לדוגמה: לעקוב אחרי התוכנית'}
            style={{ ...inputStyle, marginTop: '6px', textAlign: rtlDir(en) === 'rtl' ? 'right' : 'left' }}
            dir={en ? 'ltr' : 'rtl'}
            onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(212,175,55,.5)'; }}
            onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1f1f22'; }}
          />
        </div>

        <div>
          <Label>{en ? 'My Bias' : 'הביאס שלי'}</Label>
          <div className="flex gap-2 mt-1.5">
            {([
              { id: 'bull',    label: en ? 'Bullish' : 'עולה',   color: '#6fa580' },
              { id: 'neutral', label: en ? 'Neutral' : 'ניטרלי', color: '#d4af37' },
              { id: 'bear',    label: en ? 'Bearish' : 'יורד',   color: '#c98080' },
            ] as const).map(({ id, label, color }) => {
              const active = plan.bias === id;
              return (
                <button key={id} onClick={() => update('bias', id)}
                  className="flex-1 font-mono text-xs font-bold uppercase tracking-[0.12em] transition-all duration-200"
                  style={{
                    ...ELEVATED,
                    padding: '10px',
                    borderColor: active ? `color-mix(in srgb, ${color} 50%, transparent)` : '#1f1f22',
                    background: active ? `color-mix(in srgb, ${color} 10%, transparent)` : '#121214',
                    color: active ? color : 'rgba(255,255,255,.35)',
                  }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label>{en ? 'Max Trades' : 'מקסימום עסקאות'}</Label>
          <div className="flex items-center gap-3 mt-1.5">
            <button onClick={() => update('maxTrades', Math.max(1, plan.maxTrades - 1))}
              className="font-mono text-lg transition-colors flex items-center justify-center"
              style={{ ...ELEVATED, width: '36px', height: '36px', color: 'rgba(255,255,255,.5)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.5)'; }}>−</button>
            <span className="font-mono text-xl font-bold text-white tabular-nums w-6 text-center">{plan.maxTrades}</span>
            <button onClick={() => update('maxTrades', Math.min(20, plan.maxTrades + 1))}
              className="font-mono text-lg transition-colors flex items-center justify-center"
              style={{ ...ELEVATED, width: '36px', height: '36px', color: 'rgba(255,255,255,.5)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.5)'; }}>+</button>
          </div>
        </div>

        <div>
          <Label>{en ? 'Personal Reminder' : 'תזכורת אישית'}</Label>
          <input value={reminder} onChange={e => setReminder(e.target.value)}
            placeholder={en ? 'Add to reminders on save…' : 'יתווסף לרשימת התזכורות בשמירה…'}
            style={{ ...inputStyle, marginTop: '6px', textAlign: rtlDir(en) === 'rtl' ? 'right' : 'left' }}
            dir={en ? 'ltr' : 'rtl'}
            onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(212,175,55,.5)'; }}
            onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1f1f22'; }}
          />
        </div>

        <button onClick={onSave}
          className="w-full font-mono text-sm font-bold uppercase tracking-[0.14em] text-black transition-all duration-200"
          style={{ background: '#d4af37', borderRadius: '10px', padding: '13px', boxShadow: '0 0 22px rgba(212,175,55,.2)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 40px rgba(212,175,55,.38)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 22px rgba(212,175,55,.2)'; (e.currentTarget as HTMLElement).style.transform = ''; }}>
          {en ? 'Save Plan' : 'שמור תוכנית'}
        </button>
      </div>
    </div>
  );
}

// RTL helper (used in TradingPlanPanel)
function rtlDir(en: boolean) { return en ? 'ltr' : 'rtl'; }

// ──────────────────────────────────────────────────────────────────────────────
// 4b. RISK CALCULATOR Panel
// ──────────────────────────────────────────────────────────────────────────────

function RiskCalcPanel({ en }: { en: boolean }) {
  return (
    <div style={PANEL}>
      <SectionTitle>{en ? 'Risk Calculator' : 'מחשבון סיכון'}</SectionTitle>
      <PositionCalculator />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. REMINDERS
// ──────────────────────────────────────────────────────────────────────────────

function RemindersPanel({ en, reminders, onToggle, onDelete }: {
  en: boolean; reminders: Reminder[]; onToggle: (id: string) => void; onDelete: (id: string) => void;
}) {
  return (
    <div style={PANEL}>
      <SectionTitle>{en ? 'Personal Reminders' : 'תזכורות אישיות'}</SectionTitle>
      <div className="grid grid-cols-4 max-[900px]:grid-cols-2 max-[500px]:grid-cols-1 gap-3">
        {reminders.map(r => (
          <div key={r.id} className="flex items-start gap-2.5 transition-all duration-200"
            style={{ ...ELEVATED, padding: '12px 14px', borderColor: r.done ? 'rgba(255,255,255,.06)' : '#1f1f22', background: r.done ? 'transparent' : '#121214' }}>
            <button onClick={() => onToggle(r.id)}
              className="w-4 h-4 shrink-0 mt-0.5 flex items-center justify-center transition-colors duration-200"
              style={{ border: `1px solid ${r.done ? '#d4af37' : '#2a2a2d'}`, background: r.done ? 'rgba(212,175,55,.12)' : 'transparent', borderRadius: '4px' }}>
              {r.done && <span className="font-bold leading-none text-[10px]" style={{ color: '#d4af37' }}>✓</span>}
            </button>
            <span className="flex-1 font-mono text-xs leading-relaxed" dir={en ? 'ltr' : 'rtl'}
              style={{ color: r.done ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.6)', textDecoration: r.done ? 'line-through' : 'none' }}>
              {r.text}
            </span>
            <button onClick={() => onDelete(r.id)} className="font-mono text-[10px] shrink-0 mt-0.5 transition-colors"
              style={{ color: 'rgba(255,255,255,.15)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c98080'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.15)'; }}>×</button>
          </div>
        ))}
        {reminders.length === 0 && (
          <p className="col-span-4 font-mono text-xs py-4" style={{ color: 'rgba(255,255,255,.2)' }}>
            {en ? 'No reminders. Add one from the Trading Plan.' : 'אין תזכורות. הוסף מהתוכנית היומית.'}
          </p>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SUMMARY VIEW
// ──────────────────────────────────────────────────────────────────────────────

function SummaryView({ biasVerdict, biasColor, allStats, en }: {
  biasVerdict: string; biasColor: string; allStats: TradeStats; en: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div style={PANEL}>
        <Label>{en ? 'Daily Bias' : 'ביאס יומי'}</Label>
        <div className="mt-4 inline-flex items-center gap-4 px-6 py-5"
          style={{ border: `1px solid color-mix(in srgb, ${biasColor} 30%, transparent)`, background: `color-mix(in srgb, ${biasColor} 6%, transparent)`, borderRadius: '10px' }}>
          <span className="font-mono text-3xl" style={{ color: biasColor }}>◈</span>
          <div>
            <Label>{en ? 'Verdict' : 'הכרעה'}</Label>
            <span className="block font-bold uppercase tracking-[0.14em] mt-1"
              style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1.4rem,2.5vw,2rem)', color: biasColor }}>
              {biasVerdict}
            </span>
          </div>
        </div>
      </div>

      <div style={PANEL}>
        <SectionTitle>{en ? 'All-time Stats' : 'סטטיסטיקה כללית'}</SectionTitle>
        <div className="grid grid-cols-4 max-[600px]:grid-cols-2 gap-6">
          {[
            { label: en ? 'Total Trades' : 'סה"כ עסקאות', value: allStats.count.toString() },
            { label: en ? 'Win Rate' : 'אחוז ניצחון', value: fmtWinRate(allStats) },
            { label: en ? 'Profit Factor' : 'פרופיט פקטור', value: fmtPF(allStats) },
            { label: en ? 'Avg R' : 'R ממוצע', value: fmtAvgR(allStats) },
          ].map(({ label, value }) => (
            <div key={label}>
              <Label>{label}</Label>
              <span className="font-mono text-2xl font-bold text-white mt-1 block" dir="ltr">{value}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
          <Link href="/dashboard/analytics" className="font-mono text-xs uppercase tracking-[0.18em] transition-colors"
            style={{ color: 'rgba(255,255,255,.3)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.6)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.3)'; }}>
            {en ? '→ Full Analytics' : '← ניתוח מלא'}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────────────────

type ViewMode = 'terminal' | 'summary';

export default function DashboardView({ role = 'free' }: { role?: 'free' | 'pro' }) {
  const { lang } = useLanguage();
  const { user, isLoaded } = useUser();
  const en = lang === 'en';

  // Clock
  const [time, setTime] = useState({ h: 0, m: 0, s: 0, clock: '00:00:00' });
  useEffect(() => {
    setTime(israelTime());
    const id = setInterval(() => setTime(israelTime()), 1000);
    return () => clearInterval(id);
  }, []);

  const [view, setView] = useState<ViewMode>('terminal');
  const session = getSession(time.h, time.m);
  const sessionLabel = session ? SESSION_LABELS[session]?.[en ? 'en' : 'he'] : null;

  // Account
  const [account, setAccount] = useState<AccountConfig | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const userId = user?.id;

  useEffect(() => {
    if (!isLoaded) return;
    const cfg = loadAccount(userId);
    if (cfg) setAccount(cfg);
    else setShowSetup(true);
  }, [isLoaded, userId]);

  // User name
  const userName = user?.firstName
    || user?.username
    || user?.fullName?.split(' ')[0]
    || user?.primaryEmailAddress?.emailAddress?.split('@')[0]
    || (typeof window !== 'undefined' ? localStorage.getItem('onyx_user_name') : null)
    || (en ? 'Trader' : 'אורח');

  const localHour = new Date().getHours();
  const greeting = localHour < 12 ? (en ? 'Good morning,' : 'בוקר טוב,')
    : localHour < 17 ? (en ? 'Good afternoon,' : 'צהריים טובים,')
    : (en ? 'Good evening,' : 'ערב טוב,');

  const todayFull = new Date().toLocaleDateString(en ? 'en-US' : 'he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

  // Trades
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  useEffect(() => { setTrades(loadTrades()); }, []);

  const today  = todayISO();
  const wStart = weekStart();
  const mStart = monthStart();
  const todayTrades = trades.filter(t => t.dateISO === today);
  const weekTrades  = trades.filter(t => t.dateISO >= wStart);
  const monthTrades = trades.filter(t => t.dateISO >= mStart);

  const sumPnl = (arr: TradeEntry[]) =>
    arr.filter(t => t.result !== 'OPEN').map(tradePnL).filter((n): n is number => n !== null).reduce((a, b) => a + b, 0);

  const todayPnl = sumPnl(todayTrades);
  const weekPnl  = sumPnl(weekTrades);
  const monthPnl = sumPnl(monthTrades);
  const equity   = (account?.startingCapital ?? 0) + sumPnl(trades);
  const allStats  = computeStats(trades);

  // Plan
  const [plan, setPlan] = useState<DailyPlan>(() => typeof window === 'undefined' ? emptyPlan() : loadPlan(today));
  const [reminder, setReminder] = useState('');
  const [planDirty, setPlanDirty] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);

  function updatePlan<K extends keyof DailyPlan>(key: K, val: DailyPlan[K]) {
    setPlan(p => ({ ...p, [key]: val }));
    setPlanDirty(true); setPlanSaved(false);
  }

  // Reminders
  const [reminders, setReminders] = useState<Reminder[]>([]);
  useEffect(() => { setReminders(loadReminders()); }, []);

  function toggleReminder(id: string) { const u = reminders.map(r => r.id === id ? { ...r, done: !r.done } : r); setReminders(u); saveReminders(u); }
  function deleteReminder(id: string) { const u = reminders.filter(r => r.id !== id); setReminders(u); saveReminders(u); }
  function addReminder(text: string) { const u = [...reminders, { id: Date.now().toString(), text, done: false }]; setReminders(u); saveReminders(u); }

  function handleSavePlan() {
    savePlan(today, plan);
    setPlanDirty(false); setPlanSaved(true);
    if (reminder.trim()) { addReminder(reminder.trim()); setReminder(''); }
    setTimeout(() => setPlanSaved(false), 1800);
  }

  const biasVerdict = plan.bias === 'bull' ? 'BULLISH' : plan.bias === 'bear' ? 'BEARISH' : 'NEUTRAL';
  const biasColor = plan.bias === 'bull' ? '#6fa580' : plan.bias === 'bear' ? '#c98080' : '#d4af37';

  // Header bg
  const headerBg: React.CSSProperties = { background: 'rgba(0,0,0,.88)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' };

  return (
    <>
      {isLoaded && showSetup && (
        <AccountSetupModal en={en} uid={userId} onDone={cfg => { setAccount(cfg); setShowSetup(false); }} />
      )}

      <div className="flex flex-col flex-1 min-h-0" style={{ background: '#000' }} dir={en ? 'ltr' : 'rtl'}>

        {/* Sticky header */}
        <header className="sticky top-0 max-[880px]:top-[54px] z-50 flex items-center justify-between px-8 max-[880px]:px-4 h-[54px] shrink-0"
          style={{ ...headerBg, borderBottom: '1px solid #1c1c1e' }}>
          <span className="font-mono text-[10px] uppercase tracking-[0.26em]" style={{ color: 'rgba(255,255,255,.3)' }}>
            {en ? 'Dashboard' : 'לוח בקרה'}
          </span>
          <div className="flex items-center gap-5">
            {/* Israel clock */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,.25)' }}>IDT</span>
              <span className="font-mono text-sm font-bold text-white tabular-nums">{time.clock}</span>
              {sessionLabel && (
                <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]"
                  style={{ border: '1px solid rgba(212,175,55,.3)', background: 'rgba(212,175,55,.06)', color: '#d4af37', borderRadius: '99px' }}>
                  <span className="w-1 h-1 rounded-full bg-[#d4af37] animate-pulse" />
                  {sessionLabel}
                </span>
              )}
            </div>
            {/* View toggle */}
            <div className="flex items-center p-0.5" style={{ border: '1px solid #1c1c1e', background: '#0a0a0b', borderRadius: '8px' }}>
              {(['terminal', 'summary'] as ViewMode[]).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className="px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-200"
                  style={{ borderRadius: '6px', background: view === v ? 'rgba(212,175,55,.1)' : 'transparent', color: view === v ? '#d4af37' : 'rgba(255,255,255,.3)' }}>
                  {v === 'terminal' ? (en ? 'Terminal' : 'טרמינל') : (en ? 'Summary' : 'תקציר')}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[1400px] mx-auto px-8 max-[880px]:px-4 py-7">

            {view === 'summary' ? (
              <SummaryView biasVerdict={biasVerdict} biasColor={biasColor} allStats={allStats} en={en} />
            ) : (
              <div className="flex flex-col gap-6 pb-16">

                <HeroPanel
                  greeting={greeting} userName={userName} todayFull={todayFull}
                  session={session} en={en} rtl={!en}
                  todayTrades={todayTrades} todayPnl={todayPnl}
                  equity={equity} currency={account?.currency ?? 'USD'}
                  onEditAccount={() => setShowSetup(true)}
                />

                <AICoachPanel trades={trades} en={en} />

                <PerformancePanel
                  en={en}
                  today={{ pnl: todayPnl, stats: computeStats(todayTrades), count: todayTrades.length }}
                  week={{ pnl: weekPnl,   stats: computeStats(weekTrades),  count: weekTrades.length  }}
                  month={{ pnl: monthPnl, stats: computeStats(monthTrades), count: monthTrades.length }}
                  allStats={allStats}
                />

                {/* Tools — 2 Panels side by side */}
                <div className="grid grid-cols-2 max-[800px]:grid-cols-1 gap-6">
                  <TradingPlanPanel
                    en={en} plan={plan} reminder={reminder} setReminder={setReminder}
                    dirty={planDirty} saved={planSaved} update={updatePlan} onSave={handleSavePlan}
                  />
                  <RiskCalcPanel en={en} />
                </div>

                <RemindersPanel en={en} reminders={reminders} onToggle={toggleReminder} onDelete={deleteReminder} />

                {role === 'free' && (
                  <div className="flex items-center justify-between gap-4 px-6 py-4"
                    style={{ border: '1px solid rgba(212,175,55,.15)', background: 'rgba(212,175,55,.03)', borderRadius: '14px' }}>
                    <p className="font-mono text-xs" style={{ color: 'rgba(255,255,255,.4)' }}>
                      {en ? 'Unlock AI insights, Playbook & Rules Engine with PRO.' : 'פתח תובנות AI מלאות, פלייבוק ומנוע חוקים עם PRO.'}
                    </p>
                    <Link href="/checkout" className="font-mono text-xs font-bold uppercase tracking-[0.14em] transition-colors whitespace-nowrap"
                      style={{ color: '#d4af37' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#e5c84a'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#d4af37'; }}>
                      {en ? 'Upgrade →' : '← שדרג'}
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
