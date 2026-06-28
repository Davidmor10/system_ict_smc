'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { useLanguage } from '../hooks/useLanguage';
import { loadTrades, computeStats, tradePnL, todayISO } from '../lib/journal';
import type { TradeEntry, TradeStats } from '../lib/journal';
import PositionCalculator from './PositionCalculator';

// ─── Israel Time ──────────────────────────────────────────────────────────────

function israelTime() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? '0', 10);
  const h = get('hour'); const m = get('minute'); const s = get('second');
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
  n > 0 ? 'var(--bull-t,#6fa580)' : n < 0 ? 'var(--bear-t,#c98080)' : 'rgba(255,255,255,.5)';

function weekStart() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}
function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}

// ─── Account Config ───────────────────────────────────────────────────────────

interface AccountConfig { startingCapital: number; currency: string; createdAt: string; }

function acctKey(userId: string | null | undefined) {
  return `onyx_account_${userId ?? 'default'}`;
}
function loadAccount(userId: string | null | undefined): AccountConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(acctKey(userId));
    if (raw) return JSON.parse(raw) as AccountConfig;
  } catch { /* */ }
  return null;
}
function saveAccount(userId: string | null | undefined, cfg: AccountConfig) {
  if (typeof window !== 'undefined') localStorage.setItem(acctKey(userId), JSON.stringify(cfg));
}

// ─── Account Setup Modal ──────────────────────────────────────────────────────

function AccountSetupModal({
  en, userId, onDone,
}: { en: boolean; userId: string | null | undefined; onDone: (cfg: AccountConfig) => void }) {
  const [capital, setCapital] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'ILS' | 'EUR'>('USD');
  const [err, setErr] = useState('');

  function handleSubmit() {
    const n = parseFloat(capital.replace(/,/g, ''));
    if (!n || n <= 0) { setErr(en ? 'Please enter a valid amount > 0' : 'יש להזין סכום חוקי גדול מ-0'); return; }
    const cfg: AccountConfig = { startingCapital: n, currency, createdAt: new Date().toISOString() };
    saveAccount(userId, cfg);
    onDone(cfg);
  }

  const inputCls = 'w-full bg-[#141417] border border-[#2a2a2d] rounded-sm px-4 py-3 font-mono text-lg text-white placeholder-white/20 outline-none focus:border-[#d4af37]/60 transition-colors';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(12px)' }}>
      <div
        className="w-full max-w-sm rounded-[16px] p-8 flex flex-col gap-6"
        dir={en ? 'ltr' : 'rtl'}
        style={{ background: '#0d0d0f', border: '1px solid rgba(212,175,55,.25)', boxShadow: '0 0 80px rgba(212,175,55,.1)' }}
      >
        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="font-mono text-4xl text-[#d4af37]" style={{ textShadow: '0 0 24px rgba(212,175,55,.5)' }}>◈</span>
          <h2 className="font-mono text-base font-bold uppercase tracking-[0.2em] text-white">
            {en ? 'Account Setup' : 'הגדרת חשבון'}
          </h2>
          <p className="font-mono text-xs text-white/40 leading-relaxed">
            {en
              ? 'Set your starting capital to track equity and risk correctly.'
              : 'הגדר את ההון ההתחלתי שלך כדי לעקוב אחר ה-Equity והסיכון בצורה מדויקת.'}
          </p>
        </div>

        {/* Capital input */}
        <div>
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-white/40 mb-2">
            {en ? 'Starting Capital' : 'הון התחלתי בחשבון'}
          </span>
          <input
            dir="ltr"
            inputMode="decimal"
            value={capital}
            onChange={e => { setCapital(e.target.value); setErr(''); }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder={en ? 'e.g. 50000' : 'לדוגמה: 50000'}
            className={inputCls}
            autoFocus
          />
          {err && <p className="font-mono text-xs text-[#c98080] mt-2">{err}</p>}
        </div>

        {/* Currency selector */}
        <div>
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-white/40 mb-2">
            {en ? 'Currency' : 'מטבע'}
          </span>
          <div className="flex gap-2">
            {(['USD', 'ILS', 'EUR'] as const).map(c => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className="flex-1 py-2.5 rounded-sm border font-mono text-sm font-bold uppercase tracking-[0.12em] transition-all duration-200"
                style={{
                  borderColor: currency === c ? 'rgba(212,175,55,.5)' : '#2a2a2d',
                  background: currency === c ? 'rgba(212,175,55,.08)' : 'transparent',
                  color: currency === c ? '#d4af37' : 'rgba(255,255,255,.35)',
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handleSubmit}
          className="w-full py-3.5 rounded-sm font-mono text-sm font-bold uppercase tracking-[0.14em] text-black transition-all duration-200"
          style={{ background: '#d4af37', boxShadow: '0 0 32px rgba(212,175,55,.28)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 48px rgba(212,175,55,.45)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 32px rgba(212,175,55,.28)'; }}
        >
          {en ? 'Get Started' : 'התחל'}
        </button>
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
  try { const r = localStorage.getItem(REM_KEY); if (r) return JSON.parse(r); } catch { /* */ }
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
  try { const r = localStorage.getItem(planKey(d)); if (r) return { ...emptyPlan(), ...JSON.parse(r) }; } catch { /* */ }
  return emptyPlan();
}
function savePlan(d: string, p: DailyPlan) {
  if (typeof window !== 'undefined') localStorage.setItem(planKey(d), JSON.stringify(p));
}

// ─── Safe KPI formatters (no ∞, no fabricated values) ────────────────────────

function fmtWinRate(stats: TradeStats): string {
  if (stats.wins + stats.losses === 0) return '—';
  return `${stats.winRate.toFixed(1)}%`;
}
function fmtPF(stats: TradeStats): string {
  if (stats.losses === 0 || !isFinite(stats.profitFactor)) return '—';
  return stats.profitFactor.toFixed(2);
}
function fmtAvgR(stats: TradeStats): string {
  if (stats.wins + stats.losses === 0) return '—';
  return `${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(2)}R`;
}

// ─── AI Coach insights ────────────────────────────────────────────────────────

function buildInsights(trades: TradeEntry[], en: boolean): { tag: string; tagColor: string; text: string }[] {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const results: { tag: string; tagColor: string; text: string }[] = [];

  // Best session
  const bySess: Record<string, TradeEntry[]> = {};
  closed.forEach(t => { const k = t.session || 'UNKNOWN'; bySess[k] = [...(bySess[k] ?? []), t]; });
  const best = Object.entries(bySess)
    .map(([s, ts]) => ({ s, wr: ts.length > 0 ? ts.filter(t => t.result === 'WIN').length / ts.length : 0, n: ts.length }))
    .filter(x => x.n >= 3)
    .sort((a, b) => b.wr - a.wr)[0];
  if (best) {
    results.push({
      tag: en ? 'Opportunity' : 'הזדמנות', tagColor: 'var(--bull-t,#6fa580)',
      text: en
        ? `Your ${best.s} session shows a ${Math.round(best.wr * 100)}% win rate across ${best.n} trades. Worth focusing there.`
        : `ייתכן שכדאי לשים לב לסשן ${best.s} — ${Math.round(best.wr * 100)}% הצלחה על פני ${best.n} עסקאות.`,
    });
  }

  // Recent streak
  const recent = [...closed].reverse().slice(0, 5);
  const streakLen = recent.findIndex(t => t.result !== recent[0]?.result);
  const streak = streakLen === -1 ? recent.length : streakLen;
  if (streak >= 3 && recent[0]?.result === 'LOSS') {
    results.push({
      tag: en ? 'Warning' : 'אזהרה', tagColor: 'var(--bear-t,#c98080)',
      text: en
        ? `Consider stepping back — your last ${streak} trades were losses. Review your setup before the next entry.`
        : `אולי כדאי לעצור רגע — ${streak} עסקאות אחרונות היו הפסד. שווה לבחון את תנאי הכניסה לפני הבאה.`,
    });
  } else if (streak >= 3 && recent[0]?.result === 'WIN') {
    results.push({
      tag: en ? 'Pattern' : 'תבנית', tagColor: '#d4af37',
      text: en
        ? `You're on a ${streak}-trade winning streak. Staying consistent with your current process seems to be working.`
        : `יש לך רצף של ${streak} עסקאות מרוויחות. המשך לשמור על אותה גישה — זה עובד.`,
    });
  }

  // Avg R
  if (closed.length >= 5) {
    const avgR = closed.reduce((s, t) => s + (t.tradeR ?? 0), 0) / closed.length;
    results.push({
      tag: en ? 'Pattern' : 'תבנית אחרונה', tagColor: 'rgba(255,255,255,.4)',
      text: en
        ? `Across ${closed.length} closed trades, your average R is ${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R. ${avgR < 0.5 ? 'Consider reviewing your exit strategy.' : 'A healthy R ratio — keep letting winners run.'}`
        : `על פני ${closed.length} עסקאות, R הממוצע הוא ${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R. ${avgR < 0.5 ? 'אולי כדאי לבחון את אסטרטגיית היציאה.' : 'יחס R בריא — המשך לתת לרווחים לרוץ.'}`,
    });
  }

  return results.slice(0, 3);
}

// ─── UI atoms ─────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="mt-14 pt-12 border-t" style={{ borderColor: 'rgba(255,255,255,.06)' }} />;
}
function Label({ children }: { children: React.ReactNode }) {
  return <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-white/30 mb-1">{children}</span>;
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. HERO
// ──────────────────────────────────────────────────────────────────────────────

function HeroSection({
  greeting, userName, todayFull, session, en, rtl,
  todayTrades, todayPnl, equity, currency, onEditAccount,
}: {
  greeting: string; userName: string; todayFull: string; session: Session;
  en: boolean; rtl: boolean;
  todayTrades: TradeEntry[]; todayPnl: number;
  equity: number; currency: string;
  onEditAccount: () => void;
}) {
  const todayStats = computeStats(todayTrades);
  const sym = currency === 'ILS' ? '₪' : currency === 'EUR' ? '€' : '$';
  const fmtEq = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(equity);

  return (
    <section className="relative">
      {/* Soft radial glow — top-end corner */}
      <div
        className="absolute top-0 pointer-events-none"
        style={{
          insetInlineEnd: 0, width: '600px', height: '400px', zIndex: 0,
          background: 'radial-gradient(ellipse 300px 250px at 100% 0%, rgba(212,175,55,.07) 0%, transparent 100%)',
        }}
      />

      <div className="relative grid gap-10" style={{ gridTemplateColumns: '1.55fr 1fr' }}>

        {/* Left */}
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-[13px] text-[#d4af37] uppercase tracking-[0.22em]">
              {greeting} {userName}
            </span>
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-mono uppercase tracking-[0.16em]"
              style={{ borderColor: 'rgba(212,175,55,.3)', background: 'rgba(212,175,55,.06)', color: '#d4af37' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37] animate-pulse" />
              {en ? 'Ready to Trade' : 'מוכן למסחר'}
            </span>
          </div>

          <h1 className="leading-none font-bold" style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(2rem,4vw,3.25rem)', color: '#fff' }}>
            {todayFull}
          </h1>
          <p className="font-mono text-sm text-white/40 tracking-wide">
            {en ? 'Your daily briefing, at a glance.' : 'הסקירה היומית שלך, במבט אחד.'}
          </p>

          {/* Session chips */}
          <div className="flex items-center gap-2 flex-wrap">
            {SESSIONS.map(s => {
              const isActive = session === s.id;
              return (
                <span
                  key={s.id}
                  className="px-3 py-1.5 rounded-full font-mono text-[10px] uppercase tracking-[0.14em] border transition-all duration-250"
                  style={{
                    borderColor: isActive ? 'rgba(212,175,55,.5)' : 'rgba(255,255,255,.08)',
                    background: isActive ? 'rgba(212,175,55,.08)' : 'transparent',
                    color: isActive ? '#d4af37' : 'rgba(255,255,255,.3)',
                    fontWeight: isActive ? 700 : 500,
                    boxShadow: isActive ? '0 0 16px rgba(212,175,55,.12)' : 'none',
                  }}
                >
                  {en ? s.en : s.he}
                  <span className="ms-1.5 opacity-50">{s.time}</span>
                </span>
              );
            })}
            {!session && (
              <span className="font-mono text-[10px] text-white/25 uppercase tracking-[0.18em]">
                {en ? 'No active session' : 'אין סשן פעיל'}
              </span>
            )}
          </div>
        </div>

        {/* Right */}
        <div className="flex flex-col gap-5">
          {/* 3-cell stat grid */}
          <div className="grid grid-cols-3 gap-px rounded-sm overflow-hidden" style={{ background: '#1c1c1e' }}>
            {/* Equity */}
            <div className="px-4 py-4 bg-[#0d0d0f]">
              <Label>{en ? 'Account' : 'הון'}</Label>
              <span className="block font-mono text-lg font-bold tabular-nums text-white" dir="ltr">
                {sym}{fmtEq}
              </span>
              <button
                onClick={onEditAccount}
                className="block font-mono text-[9px] text-white/25 hover:text-[#d4af37] transition-colors mt-1 uppercase tracking-[0.14em]"
              >
                {en ? 'Edit' : 'ערוך'}
              </button>
            </div>

            {/* Today P&L */}
            <div className="px-4 py-4 bg-[#0d0d0f]">
              <Label>{en ? "Today's P&L" : 'P&L היום'}</Label>
              <span className="block font-mono text-lg font-bold tabular-nums" dir="ltr" style={{ color: pnlColor(todayPnl) }}>
                {todayTrades.length ? fmtUSD(todayPnl) : '$0'}
              </span>
              <span className="block font-mono text-[10px] text-white/25 mt-1">
                {todayStats.wins}W · {todayStats.losses}L
              </span>
            </div>

            {/* Risk/trade */}
            <div className="px-4 py-4 bg-[#0d0d0f]">
              <Label>{en ? 'Risk/Trade' : 'סיכון/עסקה'}</Label>
              <span className="block font-mono text-lg font-bold tabular-nums text-[#d4af37]" dir="ltr">
                {fmtUSD(equity * 0.01)}
              </span>
              <span className="block font-mono text-[10px] text-white/25 mt-1">1%</span>
            </div>
          </div>

          {/* CTA */}
          <Link
            href="/dashboard/journal"
            className="block text-center py-3.5 rounded-sm font-mono text-sm font-bold uppercase tracking-[0.14em] text-black transition-all duration-250"
            style={{ background: '#d4af37', boxShadow: '0 0 32px rgba(212,175,55,.28)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 48px rgba(212,175,55,.45)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 32px rgba(212,175,55,.28)'; (e.currentTarget as HTMLElement).style.transform = ''; }}
          >
            {en ? '+ Log New Trade' : '+ תיעוד עסקה חדשה'}
          </Link>

          <Link href="/dashboard/journal" className="text-center font-mono text-xs text-white/35 hover:text-white/60 transition-colors uppercase tracking-[0.18em]">
            {en ? 'Open Trading Journal →' : '← פתח יומן מסחר'}
          </Link>
        </div>
      </div>

      {/* Status strip */}
      <div className="mt-10 pt-5 grid grid-cols-4 max-[700px]:grid-cols-2 gap-4" style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
        {[
          { dot: '#6fa580', label: en ? 'Trading Status' : 'סטטוס מסחר',   val: en ? 'Ready' : 'מוכן' },
          { dot: '#6fa580', label: en ? 'Risk Status' : 'סטטוס סיכון',     val: en ? 'Within limits' : 'בתוך הגבולות' },
          { dot: '#d4af37', label: en ? 'Discipline' : 'משמעת',            val: en ? `${todayStats.wins + todayStats.losses} trades today` : `${todayStats.wins + todayStats.losses} עסקאות היום` },
          { dot: '#6fa580', label: en ? 'Account Health' : 'בריאות החשבון', val: en ? 'Strong' : 'חזקה' },
        ].map(({ dot, label, val }) => (
          <div key={label} className="flex items-center gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
            <div>
              <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-white/25">{label}</span>
              <span className="block font-mono text-xs font-bold text-white/70">{val}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. AI COACH
// ──────────────────────────────────────────────────────────────────────────────

function AICoachSection({ trades, en }: { trades: TradeEntry[]; en: boolean }) {
  const closedTrades = trades.filter(t => t.result !== 'OPEN');
  const hasData = closedTrades.length >= 3;
  const insights = hasData ? buildInsights(trades, en) : [];

  const focusText = en
    ? 'Review your most recent trades before the session opens. Look for repeated entry patterns in both winning and losing trades, and choose one specific setup to focus on today. Your edge comes from repetition.'
    : 'אולי כדאי לעבור על העסקאות האחרונות לפני פתיחת הסשן. שים לב לדפוסי הכניסה החוזרים — הן בעסקאות המרוויחות והן בהפסידות — ובחר תבנית אחת ספציפית להתמקד בה היום. היתרון שלך מגיע מחזרה עקבית.';

  return (
    <section>
      {/* Header */}
      <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          {/* Avatar — no box-background glow, only the ◈ with soft text-shadow */}
          <div
            className="w-10 h-10 rounded-sm flex items-center justify-center shrink-0 font-mono text-lg"
            style={{ background: 'rgba(212,175,55,.08)', border: '1px solid rgba(212,175,55,.2)', color: '#d4af37' }}
          >
            ◈
          </div>
          <div>
            <span className="block font-mono text-[11px] uppercase tracking-[0.24em] text-[#d4af37]">
              {en ? 'AI Coach' : 'מאמן ה-AI'}
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#6fa580] animate-pulse" />
              <span className="font-mono text-[10px] text-white/30 uppercase tracking-[0.12em]">
                {en ? 'Based on your journal' : 'מבוסס על היומן שלך'}
              </span>
            </div>
          </div>
        </div>
        <Link href="/dashboard/analytics" className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30 hover:text-white/60 transition-colors">
          {en ? 'View All →' : '← הצג הכל'}
        </Link>
      </div>

      {/* Soft top-left glow — blurred circle, no hard edges */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '-60px', left: '-60px', width: '400px', height: '400px',
          background: 'rgba(212,175,55,.04)',
          filter: 'blur(80px)',
          borderRadius: '50%',
          zIndex: 0,
        }}
      />

      {!hasData ? (
        /* ─ Onboarding / empty state ─ */
        <div
          className="relative rounded-sm px-8 py-10 text-center"
          style={{ border: '1px dashed rgba(212,175,55,.15)', background: 'rgba(212,175,55,.02)' }}
          dir={en ? 'ltr' : 'rtl'}
        >
          <span className="block font-mono text-5xl text-[#d4af37] opacity-20 mb-4">◈</span>
          <p className="font-mono text-sm text-white/50 leading-relaxed mb-2">
            {en
              ? 'Welcome to Onyx. Start logging trades and the coach will identify your patterns — when you win, where you lose, and what to improve.'
              : 'ברוך הבא ל-Onyx. התחל לתעד עסקאות והמאמן יזהה עבורך דפוסים — מתי אתה מרוויח, איפה אתה מפסיד, ומה לשפר.'}
          </p>
          <p className="font-mono text-[10px] text-white/20 mt-4">
            {en
              ? 'Insights appear after 3+ closed trades. Insights are based solely on your personal journal data and do not constitute trading advice.'
              : 'תובנות יופיעו לאחר 3+ עסקאות סגורות. התובנות מבוססות אך ורק על נתוני היומן האישי שלך ואינן מהוות ייעוץ מסחרי.'}
          </p>
        </div>
      ) : (
        /* ─ 2-col insights layout ─ */
        <div className="relative grid grid-cols-[1.4fr_1fr] max-[800px]:grid-cols-1 gap-10" style={{ zIndex: 1 }}>

          {/* Left: focus */}
          <div>
            <Label>{en ? "Today's Focus" : 'הפוקוס של היום'}</Label>
            <p
              className="mt-2 leading-relaxed text-white/65"
              style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1rem,1.4vw,1.15rem)', lineHeight: 1.7 }}
              dir={en ? 'ltr' : 'rtl'}
            >
              {focusText}
            </p>
          </div>

          {/* Right: 3 insights */}
          <div className="flex flex-col gap-5">
            {insights.map(({ tag, tagColor, text }) => (
              <div key={tag} className="flex gap-3">
                <div
                  className="w-5 h-5 rounded-sm flex items-center justify-center font-mono text-[9px] shrink-0 mt-0.5"
                  style={{
                    background: `color-mix(in srgb, ${tagColor} 10%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${tagColor} 25%, transparent)`,
                    color: tagColor,
                  }}
                >◈</div>
                <div>
                  <span className="block font-mono text-[9px] uppercase tracking-[0.2em] mb-1" style={{ color: tagColor }}>{tag}</span>
                  <p className="font-mono text-xs text-white/50 leading-relaxed" dir={en ? 'ltr' : 'rtl'}>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disclaimer — only when showing real insights */}
      {hasData && (
        <div className="mt-8 pt-4 font-mono text-[10px] text-white/20 leading-relaxed" style={{ borderTop: '1px solid rgba(255,255,255,.05)' }} dir={en ? 'ltr' : 'rtl'}>
          {en
            ? 'Insights are based solely on your personal journal data and do not constitute trading advice or investment recommendations.'
            : 'התובנות מבוססות אך ורק על נתוני היומן האישי שלך ואינן מהוות ייעוץ מסחרי או המלצת השקעה.'}
        </div>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. PERFORMANCE
// ──────────────────────────────────────────────────────────────────────────────

function PerformanceSection({ en, today, week, month, allStats }: {
  en: boolean;
  today: { pnl: number; stats: TradeStats; count: number };
  week:  { pnl: number; stats: TradeStats; count: number };
  month: { pnl: number; stats: TradeStats; count: number };
  allStats: TradeStats;
}) {
  const noTrades = allStats.count === 0;

  return (
    <section>
      <div className="flex items-baseline gap-4 mb-8 flex-wrap">
        <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/30">
          {en ? 'Performance' : 'ביצועים'}
        </span>
      </div>

      {noTrades ? (
        /* ─ Empty state ─ */
        <div
          className="flex flex-col items-center gap-5 py-16 text-center rounded-sm"
          style={{ border: '1px dashed rgba(255,255,255,.06)' }}
        >
          <span className="font-mono text-5xl text-white opacity-10">◈</span>
          <p className="font-mono text-sm text-white/30">
            {en ? 'No performance data yet' : 'אין עדיין נתוני ביצועים'}
          </p>
          <p className="font-mono text-xs text-white/20 max-w-xs leading-relaxed" dir={en ? 'ltr' : 'rtl'}>
            {en
              ? 'Log your first trade to start tracking performance across today, this week, and this month.'
              : 'תעד את העסקה הראשונה שלך כדי להתחיל לעקוב אחר הביצועים — היום, השבוע, והחודש.'}
          </p>
          <Link
            href="/dashboard/journal"
            className="px-6 py-2.5 rounded-sm font-mono text-xs font-bold uppercase tracking-[0.14em] text-black transition-all duration-200"
            style={{ background: '#d4af37', boxShadow: '0 0 24px rgba(212,175,55,.2)' }}
          >
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
                <div
                  className="font-bold tabular-nums mt-1 mb-2 leading-none"
                  style={{
                    fontFamily: 'var(--serif)',
                    fontSize: 'clamp(2rem,3.5vw,3rem)',
                    color: count ? pnlColor(pnl) : 'rgba(255,255,255,.2)',
                  }}
                  dir="ltr"
                >
                  {count ? fmtUSD(pnl) : '$0'}
                </div>
                <div className="flex items-center gap-3 font-mono text-[10px] text-white/35">
                  <span dir="ltr">{fmtAvgR(stats)}</span>
                  <span className="w-px h-3 bg-white/10" />
                  <span dir="ltr">{fmtWinRate(stats)}</span>
                  <span className="w-px h-3 bg-white/10" />
                  <span dir="ltr">{stats.wins}W / {stats.losses}L</span>
                </div>
              </div>
            ))}
          </div>

          {/* KPI row */}
          <div className="mt-8 pt-6 grid grid-cols-3 max-[600px]:grid-cols-1 gap-6" style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
            {[
              {
                label: en ? 'Win Rate' : 'אחוז הצלחה',
                value: fmtWinRate(allStats),
                gold: true,
                sub: `${allStats.wins + allStats.losses} ${en ? 'closed' : 'סגורות'}`,
              },
              {
                label: en ? 'Profit Factor' : 'פרופיט פקטור',
                value: fmtPF(allStats),
                gold: false,
                sub: en ? 'gross win / gross loss' : 'רווח גולמי / הפסד גולמי',
              },
              {
                label: en ? 'Avg R' : 'R ממוצע',
                value: fmtAvgR(allStats),
                gold: false,
                sub: en ? 'across all trades' : 'על פני כל העסקאות',
              },
            ].map(({ label, value, gold, sub }) => (
              <div key={label}>
                <Label>{label}</Label>
                <span
                  className="block font-mono text-2xl font-bold tabular-nums"
                  dir="ltr"
                  style={gold
                    ? { color: '#d4af37', textShadow: '0 0 20px rgba(212,175,55,.4)' }
                    : { color: 'rgba(255,255,255,.8)' }
                  }
                >
                  {value}
                </span>
                <span className="block font-mono text-[10px] text-white/25 mt-1">{sub}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. TOOLS
// ──────────────────────────────────────────────────────────────────────────────

function TradingPlanCard({ en, plan, reminder, setReminder, dirty, saved, update, onSave }: {
  en: boolean; plan: DailyPlan; reminder: string; setReminder: (v: string) => void;
  dirty: boolean; saved: boolean;
  update: <K extends keyof DailyPlan>(k: K, v: DailyPlan[K]) => void;
  onSave: () => void;
}) {
  const inputCls = 'w-full bg-[#141417] border border-[#2a2a2d] rounded-sm px-3 py-2.5 font-mono text-sm text-white placeholder-white/20 outline-none focus:border-[#d4af37]/50 transition-colors duration-200';

  return (
    <div className="rounded-[16px] p-6 flex flex-col gap-5" style={{ background: '#0d0d0f', border: '1px solid #1c1c1e', boxShadow: '0 4px 32px rgba(0,0,0,.4)' }}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/40">
          {en ? "Today's Trading Plan" : 'תוכנית המסחר להיום'}
        </span>
        {dirty && !saved && (
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] px-2 py-1 rounded-full border" style={{ borderColor: 'rgba(212,175,55,.35)', color: '#d4af37', background: 'rgba(212,175,55,.06)' }}>
            {en ? 'Unsaved' : 'לא נשמר'}
          </span>
        )}
        {saved && <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#6fa580]">{en ? 'Saved ✓' : '✓ נשמר'}</span>}
      </div>

      <div>
        <Label>{en ? 'Goal for today' : 'המטרה של היום'}</Label>
        <input value={plan.goal} onChange={e => update('goal', e.target.value)} placeholder={en ? 'e.g. Follow the plan, no revenge trades' : 'לדוגמה: לעקוב אחרי התוכנית'} className={inputCls} dir={en ? 'ltr' : 'rtl'} />
      </div>

      <div>
        <Label>{en ? 'My Bias' : 'הביאס שלי'}</Label>
        <div className="flex gap-2">
          {([
            { id: 'bull',    label: en ? 'Bullish' : 'עולה',   color: '#6fa580' },
            { id: 'neutral', label: en ? 'Neutral' : 'ניטרלי', color: '#d4af37' },
            { id: 'bear',    label: en ? 'Bearish' : 'יורד',   color: '#c98080' },
          ] as const).map(({ id, label, color }) => {
            const active = plan.bias === id;
            return (
              <button key={id} onClick={() => update('bias', id)}
                className="flex-1 py-2.5 rounded-sm border font-mono text-xs font-bold uppercase tracking-[0.12em] transition-all duration-200"
                style={{
                  borderColor: active ? `color-mix(in srgb, ${color} 50%, transparent)` : '#2a2a2d',
                  background: active ? `color-mix(in srgb, ${color} 10%, transparent)` : 'transparent',
                  color: active ? color : 'rgba(255,255,255,.35)',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>{en ? 'Max Trades' : 'מקסימום עסקאות'}</Label>
        <div className="flex items-center gap-3">
          <button onClick={() => update('maxTrades', Math.max(1, plan.maxTrades - 1))} className="w-9 h-9 rounded-sm border border-[#2a2a2d] font-mono text-lg text-white/50 hover:text-white hover:border-[#d4af37]/40 transition-colors flex items-center justify-center">−</button>
          <span className="font-mono text-xl font-bold text-white tabular-nums w-6 text-center">{plan.maxTrades}</span>
          <button onClick={() => update('maxTrades', Math.min(20, plan.maxTrades + 1))} className="w-9 h-9 rounded-sm border border-[#2a2a2d] font-mono text-lg text-white/50 hover:text-white hover:border-[#d4af37]/40 transition-colors flex items-center justify-center">+</button>
        </div>
      </div>

      <div>
        <Label>{en ? 'Personal Reminder' : 'תזכורת אישית'}</Label>
        <input value={reminder} onChange={e => setReminder(e.target.value)} placeholder={en ? 'Add to reminders on save…' : 'יתווסף לרשימת התזכורות בשמירה…'} className={inputCls} dir={en ? 'ltr' : 'rtl'} />
      </div>

      <button onClick={onSave} className="w-full py-3 rounded-sm font-mono text-sm font-bold uppercase tracking-[0.14em] text-black transition-all duration-200" style={{ background: '#d4af37', boxShadow: '0 0 24px rgba(212,175,55,.22)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 40px rgba(212,175,55,.4)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 24px rgba(212,175,55,.22)'; (e.currentTarget as HTMLElement).style.transform = ''; }}
      >
        {en ? 'Save Plan' : 'שמור תוכנית'}
      </button>
    </div>
  );
}

function ToolsSection({ en, plan, reminder, setReminder, planDirty, planSaved, updatePlan, onSavePlan }: {
  en: boolean; plan: DailyPlan; reminder: string; setReminder: (v: string) => void;
  planDirty: boolean; planSaved: boolean;
  updatePlan: <K extends keyof DailyPlan>(k: K, v: DailyPlan[K]) => void;
  onSavePlan: () => void;
}) {
  return (
    <section>
      <Label>{en ? 'Tools' : 'כלים'}</Label>
      <div className="mt-6 grid grid-cols-2 max-[800px]:grid-cols-1 gap-6">
        <TradingPlanCard en={en} plan={plan} reminder={reminder} setReminder={setReminder} dirty={planDirty} saved={planSaved} update={updatePlan} onSave={onSavePlan} />
        <div className="rounded-[16px] p-6" style={{ background: '#0d0d0f', border: '1px solid #1c1c1e', boxShadow: '0 4px 32px rgba(0,0,0,.4)' }}>
          <span className="block font-mono text-[11px] uppercase tracking-[0.24em] text-white/40 mb-5">
            {en ? 'Risk Calculator' : 'מחשבון סיכון'}
          </span>
          <PositionCalculator />
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. REMINDERS
// ──────────────────────────────────────────────────────────────────────────────

function RemindersSection({ en, reminders, onToggle, onDelete }: {
  en: boolean; reminders: Reminder[]; onToggle: (id: string) => void; onDelete: (id: string) => void;
}) {
  return (
    <section>
      <Label>{en ? 'Personal Reminders' : 'תזכורות אישיות'}</Label>
      <div className="mt-5 grid grid-cols-4 max-[900px]:grid-cols-2 max-[500px]:grid-cols-1 gap-3">
        {reminders.map(r => (
          <div key={r.id} className="flex items-start gap-2.5 px-4 py-3 rounded-sm border transition-colors duration-200"
            style={{ borderColor: r.done ? 'rgba(255,255,255,.05)' : '#1c1c1e', background: r.done ? 'transparent' : '#0d0d0f' }}>
            <button onClick={() => onToggle(r.id)} className="w-4 h-4 rounded-sm border shrink-0 mt-0.5 flex items-center justify-center transition-colors duration-200"
              style={{ borderColor: r.done ? '#d4af37' : '#2a2a2d', background: r.done ? 'rgba(212,175,55,.12)' : 'transparent' }}>
              {r.done && <span className="text-[#d4af37] text-[10px] font-bold leading-none">✓</span>}
            </button>
            <span className="flex-1 font-mono text-xs leading-relaxed" dir={en ? 'ltr' : 'rtl'}
              style={{ color: r.done ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.6)', textDecoration: r.done ? 'line-through' : 'none' }}>
              {r.text}
            </span>
            <button onClick={() => onDelete(r.id)} className="font-mono text-[10px] text-white/15 hover:text-[#c98080] transition-colors shrink-0 mt-0.5">×</button>
          </div>
        ))}
        {reminders.length === 0 && (
          <p className="col-span-4 font-mono text-xs text-white/20 py-4">
            {en ? 'No reminders. Add one from the Trading Plan.' : 'אין תזכורות. הוסף מהתוכנית היומית.'}
          </p>
        )}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SUMMARY VIEW
// ──────────────────────────────────────────────────────────────────────────────

function SummaryView({ biasVerdict, biasColor, allStats, en }: {
  biasVerdict: string; biasColor: string; allStats: TradeStats; en: boolean;
}) {
  return (
    <div className="space-y-8">
      <div>
        <Label>{en ? 'Daily Bias' : 'ביאס יומי'}</Label>
        <div className="mt-4 inline-flex items-center gap-4 px-8 py-6 rounded-sm border"
          style={{ borderColor: `color-mix(in srgb, ${biasColor} 30%, transparent)`, background: `color-mix(in srgb, ${biasColor} 6%, transparent)` }}>
          <span className="font-mono text-4xl" style={{ color: biasColor }}>◈</span>
          <div>
            <Label>{en ? 'Bias Verdict' : 'הכרעת הביאס'}</Label>
            <span className="block font-bold uppercase tracking-[0.14em]"
              style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1.5rem,2.5vw,2rem)', color: biasColor }}>
              {biasVerdict}
            </span>
          </div>
        </div>
      </div>
      <div className="pt-6" style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
        <Label>{en ? 'All-time Stats' : 'סטטיסטיקה כללית'}</Label>
        <div className="mt-4 grid grid-cols-4 max-[600px]:grid-cols-2 gap-6">
          {[
            { label: en ? 'Total Trades' : 'סה"כ עסקאות', value: allStats.count.toString() },
            { label: en ? 'Win Rate' : 'אחוז ניצחון', value: fmtWinRate(allStats) },
            { label: en ? 'Profit Factor' : 'פרופיט פקטור', value: fmtPF(allStats) },
            { label: en ? 'Avg R' : 'R ממוצע', value: fmtAvgR(allStats) },
          ].map(({ label, value }) => (
            <div key={label}>
              <Label>{label}</Label>
              <span className="font-mono text-2xl font-bold text-white" dir="ltr">{value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="pt-4" style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
        <Link href="/dashboard/analytics" className="font-mono text-xs text-white/30 hover:text-white/60 uppercase tracking-[0.18em] transition-colors">
          {en ? '→ Full Analytics' : '← ניתוח מלא'}
        </Link>
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
  const rtl = !en;

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

  // ── Account ────────────────────────────────────────────────────────────────
  const [account, setAccount] = useState<AccountConfig | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const userId = user?.id;

  useEffect(() => {
    if (!isLoaded) return;
    const cfg = loadAccount(userId);
    if (cfg) { setAccount(cfg); }
    else { setShowSetup(true); }
  }, [isLoaded, userId]);

  function handleAccountDone(cfg: AccountConfig) {
    setAccount(cfg);
    setShowSetup(false);
  }

  // ── User name ──────────────────────────────────────────────────────────────
  const userName = user?.firstName
    || user?.username
    || user?.fullName?.split(' ')[0]
    || user?.primaryEmailAddress?.emailAddress?.split('@')[0]
    || (typeof window !== 'undefined' ? localStorage.getItem('onyx_user_name') : null)
    || (en ? 'Trader' : 'אורח');

  const localHour = new Date().getHours();
  const greeting = localHour < 12
    ? (en ? 'Good morning,' : 'בוקר טוב,')
    : localHour < 17
    ? (en ? 'Good afternoon,' : 'צהריים טובים,')
    : (en ? 'Good evening,' : 'ערב טוב,');

  const todayFull = new Date().toLocaleDateString(en ? 'en-US' : 'he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

  // ── Trades ─────────────────────────────────────────────────────────────────
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  useEffect(() => { setTrades(loadTrades()); }, []);

  const today  = todayISO();
  const wStart = weekStart();
  const mStart = monthStart();

  const todayTrades = trades.filter(t => t.dateISO === today);
  const weekTrades  = trades.filter(t => t.dateISO >= wStart);
  const monthTrades = trades.filter(t => t.dateISO >= mStart);

  // Compute P&L from real data, independently per period
  const sumPnl = (arr: TradeEntry[]) =>
    arr.filter(t => t.result !== 'OPEN').map(tradePnL).filter((n): n is number => n !== null).reduce((a, b) => a + b, 0);

  const todayPnl = sumPnl(todayTrades);
  const weekPnl  = sumPnl(weekTrades);
  const monthPnl = sumPnl(monthTrades);

  // Equity = startingCapital + total realized P&L (all time)
  const allClosedPnl = sumPnl(trades);
  const startingCapital = account?.startingCapital ?? 0;
  const equity = startingCapital + allClosedPnl;

  const allStats = computeStats(trades);

  // ── Plan ───────────────────────────────────────────────────────────────────
  const [plan, setPlan] = useState<DailyPlan>(() => {
    if (typeof window === 'undefined') return emptyPlan();
    return loadPlan(today);
  });
  const [reminder, setReminder] = useState('');
  const [planDirty, setPlanDirty] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);

  function updatePlan<K extends keyof DailyPlan>(key: K, val: DailyPlan[K]) {
    setPlan(p => ({ ...p, [key]: val }));
    setPlanDirty(true);
    setPlanSaved(false);
  }

  // ── Reminders ──────────────────────────────────────────────────────────────
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

  return (
    <>
      {/* Account setup modal */}
      {isLoaded && showSetup && (
        <AccountSetupModal en={en} userId={userId} onDone={handleAccountDone} />
      )}

      <div className="flex flex-col flex-1 min-h-0 bg-[#050505]" dir={rtl ? 'rtl' : 'ltr'}>

        {/* Sticky header */}
        <header
          className="sticky top-0 max-[880px]:top-[54px] z-50 flex items-center justify-between px-14 max-[880px]:px-4 h-[54px] shrink-0 border-b border-[#1c1c1e]"
          style={{ background: 'rgba(5,5,5,.88)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/30">
            {en ? 'Dashboard' : 'לוח בקרה'}
          </span>

          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/25">IDT</span>
              <span className="font-mono text-sm font-bold text-white tabular-nums">{time.clock}</span>
              {sessionLabel && (
                <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border font-mono text-[9px] uppercase tracking-[0.14em]"
                  style={{ borderColor: 'rgba(212,175,55,.3)', background: 'rgba(212,175,55,.06)', color: '#d4af37' }}>
                  <span className="w-1 h-1 rounded-full bg-[#d4af37] animate-pulse" />
                  {sessionLabel}
                </span>
              )}
            </div>

            <div className="flex items-center p-0.5 rounded-sm border border-[#1c1c1e] bg-[#0d0d0f]">
              {(['terminal', 'summary'] as ViewMode[]).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className="px-3 py-1 rounded-sm font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-200"
                  style={{ background: view === v ? 'rgba(212,175,55,.1)' : 'transparent', color: view === v ? '#d4af37' : 'rgba(255,255,255,.3)' }}>
                  {v === 'terminal' ? (en ? 'Terminal' : 'טרמינל') : (en ? 'Summary' : 'תקציר')}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[1560px] mx-auto px-14 max-[880px]:px-4 pt-12 pb-24">

            {view === 'summary' ? (
              <SummaryView biasVerdict={biasVerdict} biasColor={biasColor} allStats={allStats} en={en} />
            ) : (
              <>
                <HeroSection
                  greeting={greeting} userName={userName} todayFull={todayFull}
                  session={session} en={en} rtl={rtl}
                  todayTrades={todayTrades} todayPnl={todayPnl}
                  equity={equity} currency={account?.currency ?? 'USD'}
                  onEditAccount={() => setShowSetup(true)}
                />

                <Divider />
                <AICoachSection trades={trades} en={en} />

                <Divider />
                <PerformanceSection
                  en={en}
                  today={{ pnl: todayPnl, stats: computeStats(todayTrades), count: todayTrades.length }}
                  week={{ pnl: weekPnl,   stats: computeStats(weekTrades),  count: weekTrades.length  }}
                  month={{ pnl: monthPnl, stats: computeStats(monthTrades), count: monthTrades.length }}
                  allStats={allStats}
                />

                <Divider />
                <ToolsSection
                  en={en} plan={plan} reminder={reminder} setReminder={setReminder}
                  planDirty={planDirty} planSaved={planSaved}
                  updatePlan={updatePlan} onSavePlan={handleSavePlan}
                />

                <Divider />
                <RemindersSection en={en} reminders={reminders} onToggle={toggleReminder} onDelete={deleteReminder} />

                {role === 'free' && (
                  <>
                    <Divider />
                    <div className="flex items-center justify-between gap-4 px-6 py-4 rounded-sm border"
                      style={{ borderColor: 'rgba(212,175,55,.15)', background: 'rgba(212,175,55,.04)' }}>
                      <p className="font-mono text-xs text-white/40">
                        {en ? 'Unlock AI insights, Playbook & Rules Engine with PRO.' : 'פתח תובנות AI מלאות, פלייבוק ומנוע חוקים עם PRO.'}
                      </p>
                      <Link href="/checkout" className="font-mono text-xs font-bold text-[#d4af37] hover:text-[#e5c84a] transition-colors whitespace-nowrap uppercase tracking-[0.14em]">
                        {en ? 'Upgrade →' : '← שדרג'}
                      </Link>
                    </div>
                  </>
                )}
              </>
            )}

          </div>
        </div>
      </div>
    </>
  );
}
