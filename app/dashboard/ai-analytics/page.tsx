'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadTrades, todayISO } from '../../lib/journal';
import type { TradeEntry } from '../../lib/journal';
import { runFullAnalysis, isoWeekKey } from '../../lib/analytics';
import type { ConfidenceLevel, GroupPerformance } from '../../lib/analytics';
import { SESS, getActiveSessionKey } from '../../lib/sessions';
import EmptyState from '../../components/EmptyState';
import InsightText from '../../components/InsightText';
import TypingDots from '../../components/TypingDots';

/** Mirror app/lib/ai/patternInsights.ts and weeklyReport.ts's return shapes
    as local types (not imported) so this client component never pulls in
    the server-only Gemini SDK module. */
interface PatternInsight { subject: string; title: string; evidence: string; confidenceLevel: ConfidenceLevel; sampleSize: number; }
interface WeeklyReport {
  biggestStrength: string;
  biggestWeakness: string;
  largestImprovement: string;
  largestDecline: string;
  focusNextWeek: string;
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
}

function fmtPF(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '∞';
}

const SESSION_HE: Record<string, string> = Object.fromEntries(SESS.map(s => [s.key, s.he]));
const DIRECTION_HE: Record<string, string> = { LONG: 'לונג', SHORT: 'שורט' };
const WEEKDAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTH_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const CONF_LABEL: Record<ConfidenceLevel, string> = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
const CONF_META: Record<ConfidenceLevel, { fg: string; bg: string; bd: string }> = {
  low:    { fg: '#d4af37', bg: 'rgba(212,175,55,.08)', bd: 'rgba(212,175,55,.4)' },
  medium: { fg: '#6fa580', bg: 'rgba(74,124,89,.08)',  bd: 'rgba(74,124,89,.4)'  },
  high:   { fg: '#6fa580', bg: 'rgba(74,124,89,.14)',  bd: 'rgba(74,124,89,.6)'  },
};

/* ══════════ Animation primitives — mirrors the reference design's
   scroll-reveal / count-up / bar-fill behavior ══════════ */

/** Triggers slightly BEFORE an element scrolls into view (positive rootMargin
    extends the intersection root past the real viewport edge), so the reveal
    transition finishes by the time a normal scroll actually brings the section
    into sight — instead of still being mid-fade (and looking broken/blank) at
    the moment a user's eye, or a screenshot, reaches it. */
function useInView<T extends HTMLElement>(threshold = 0.01) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { setVisible(true); io.unobserve(el); } });
    }, { threshold, rootMargin: '0px 0px 180px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, visible] as const;
}

function Reveal({ children, style, className }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  const [ref, visible] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(6px)',
        filter: visible ? 'none' : 'blur(2px)',
        transition: 'opacity .35s var(--ease-expo-out), transform .35s var(--ease-expo-out), filter .35s var(--ease-expo-out)',
      }}
    >
      {children}
    </div>
  );
}

function CountUp({ to, decimals = 0, prefix = '', suffix = '', style, className }: {
  to: number; decimals?: number; prefix?: string; suffix?: string; style?: React.CSSProperties; className?: string;
}) {
  const [ref, visible] = useInView<HTMLSpanElement>();
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!visible || !Number.isFinite(to)) return;
    let raf = 0;
    const dur = 900, t0 = performance.now();
    const step = (now: number) => {
      const prog = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - prog, 3);
      setVal(to * eased);
      if (prog < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [visible, to]);
  if (!Number.isFinite(to)) return <span ref={ref} className={`num ${className || ''}`} style={style}>∞</span>;
  return <span ref={ref} className={`num ${className || ''}`} style={style}>{prefix}{val.toFixed(decimals)}{suffix}</span>;
}

/** Horizontal fill bar — amber/gold intensity scales with the value's share of the row's max. */
function HBar({ pct }: { pct: number }) {
  const [ref, visible] = useInView<HTMLDivElement>();
  const clamped = Math.max(2, Math.min(100, pct));
  const gradient =
    clamped >= 90 ? 'linear-gradient(90deg,#3a3a3d,#d4af37)' :
    clamped >= 65 ? 'linear-gradient(90deg,#2a2a2d,#8a7736)' :
                    'linear-gradient(90deg,#2a2a2d,#5c5230)';
  const glow = clamped >= 90 ? '0 0 16px rgba(212,175,55,.35)' : undefined;
  return (
    <div ref={ref} style={{ height: 9, background: '#101013', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
      <div style={{
        position: 'absolute', insetInlineStart: 0, top: 0, height: '100%',
        width: visible ? `${clamped}%` : '0%', borderRadius: 2, background: gradient, boxShadow: glow,
        transition: 'width 1s var(--ease-expo-out)',
      }} />
    </div>
  );
}

/** Vertical fill bar — for the weekday/hour time-signature charts. */
function VBar({ pct, tone, label }: { pct: number; tone: 'best' | 'worst' | 'mid'; label: string }) {
  const [ref, visible] = useInView<HTMLDivElement>();
  const gradient =
    tone === 'best'  ? 'linear-gradient(180deg,#d4af37,#6b5820)' :
    tone === 'worst' ? 'linear-gradient(180deg,rgba(139,58,58,.6),rgba(139,58,58,.2))' :
                        'linear-gradient(180deg,#2a2a2d,#171718)';
  const glow = tone === 'best' ? '0 0 18px rgba(212,175,55,.3)' : undefined;
  const color = tone === 'best' ? '#d4af37' : tone === 'worst' ? '#c98080' : 'rgba(255,255,255,.45)';
  const weight = tone === 'mid' ? 700 : 800;
  return (
    <div ref={ref} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 9 }}>
      <div style={{
        width: '100%', maxWidth: 56, height: visible ? `${Math.max(6, pct)}%` : '0%',
        borderRadius: '3px 3px 0 0', background: gradient, boxShadow: glow,
        transition: 'height 1s var(--ease-expo-out)',
      }} />
      <span className="font-mono" style={{ fontSize: 11, fontWeight: weight, color }}>{label}</span>
    </div>
  );
}

function ConfidenceBadge({ level, sampleSize }: { level: ConfidenceLevel; sampleSize: number }) {
  const m = CONF_META[level];
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] px-2.5 py-1 rounded-sm shrink-0"
      style={{ color: m.fg, background: m.bg, border: `1px solid ${m.bd}` }}
    >
      ביטחון {CONF_LABEL[level]} · n={sampleSize}
    </span>
  );
}

/** Section shell — sticky numbered index card on the right (RTL start), content on the left. */
function NumberedSection({ index, total, eyebrow, title, description, extra, children }: {
  index: number; total: number; eyebrow: string; title: string; description: string; extra?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section
      className="grid grid-cols-1 min-[760px]:grid-cols-[clamp(220px,20vw,280px)_minmax(0,1fr)] border-t border-[#1c1c1e]"
      style={{ gap: 'clamp(36px,4vw,72px)', padding: 'clamp(52px,5vw,80px) 0' }}
    >
      <Reveal className="text-right min-[760px]:sticky min-[760px]:top-[84px] min-[760px]:self-start">
        <div className="font-mono text-xs font-bold text-[#52525b] tracking-[0.28em] mb-4" dir="ltr">{String(index).padStart(2, '0')} / {String(total).padStart(2, '0')}</div>
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-[#d4af37] mb-3">◈ {eyebrow}</div>
        <h3 className="font-serif font-bold text-white leading-tight" style={{ fontSize: 'clamp(26px,2.6vw,34px)' }}>{title}</h3>
        <p className="mt-4 text-sm text-white/55 leading-relaxed">{description}</p>
        {extra}
      </Reveal>
      <div>{children}</div>
    </section>
  );
}

export default function AiAnalyticsPage() {
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [patternInsights, setPatternInsights] = useState<PatternInsight[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReport | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [reportHistory, setReportHistory] = useState<{ weekKey: string; report: WeeklyReport }[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => { setTrades(loadTrades()); }, []);

  const analysis = useMemo(() => runFullAnalysis(trades), [trades]);
  const hasEnoughData = trades.filter(t => t.result !== 'OPEN').length >= 3;
  const activeSession = getActiveSessionKey();

  // ── Pattern insights (AI-phrased, cached per day) ──
  useEffect(() => {
    if (!hasEnoughData) { setPatternInsights([]); return; }
    const cacheKey = 'onyx_ai_patterns_' + todayISO();
    const cached = localStorage.getItem(cacheKey);
    if (cached) { try { setPatternInsights(JSON.parse(cached)); return; } catch {} }
    setPatternsLoading(true);
    fetch('/api/ai/pattern-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trades, lang: 'he' }),
    })
      .then(r => r.json())
      .then(({ insights }) => {
        if (Array.isArray(insights)) {
          setPatternInsights(insights);
          try { localStorage.setItem(cacheKey, JSON.stringify(insights)); } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setPatternsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades.length]);

  // ── Weekly AI report (cached per ISO week) + history archive ──
  useEffect(() => {
    try {
      const h = localStorage.getItem('onyx_ai_weekly_report_history');
      if (h) setReportHistory(JSON.parse(h));
    } catch {}
  }, []);

  useEffect(() => {
    if (!hasEnoughData) { setWeeklyReport(null); return; }
    const weekKey = isoWeekKey(todayISO());
    const cacheKey = 'onyx_ai_weekly_report_' + weekKey;
    const cached = localStorage.getItem(cacheKey);
    if (cached) { try { setWeeklyReport(JSON.parse(cached)); return; } catch {} }
    setWeeklyLoading(true);
    fetch('/api/ai/weekly-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trades, lang: 'he' }),
    })
      .then(r => r.json())
      .then(({ report }: { report: WeeklyReport | null }) => {
        if (!report) return;
        setWeeklyReport(report);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(report));
          setReportHistory(prev => {
            const withoutThisWeek = prev.filter(h => h.weekKey !== weekKey);
            const updated = [{ weekKey, report }, ...withoutThisWeek].slice(0, 12);
            localStorage.setItem('onyx_ai_weekly_report_history', JSON.stringify(updated));
            return updated;
          });
        } catch {}
      })
      .catch(() => {})
      .finally(() => setWeeklyLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades.length]);

  /* ── Derived, purely-computed data (no AI) for sections 01–04 ── */

  const instrumentRows = useMemo(() => {
    const sorted = [...analysis.instruments].sort((a, b) => b.totalPnl - a.totalPnl);
    const maxAbs = Math.max(1, ...sorted.map(g => Math.abs(g.totalPnl)));
    return sorted.map((g, i) => ({
      ...g,
      pct: (Math.abs(g.totalPnl) / maxAbs) * 100,
      badge: sorted.length > 1 ? (i === 0 ? 'best' as const : i === sorted.length - 1 ? 'worst' as const : null) : null,
    }));
  }, [analysis.instruments]);

  const confirmationRows = useMemo(() => {
    const sorted = [...analysis.confirmations].sort((a, b) => b.totalPnl - a.totalPnl);
    const maxAbs = Math.max(1, ...sorted.map(g => Math.abs(g.totalPnl)));
    return sorted.map((g, i) => ({
      ...g,
      pct: (Math.abs(g.totalPnl) / maxAbs) * 100,
      badge: sorted.length > 1 ? (i === 0 ? 'best' as const : i === sorted.length - 1 ? 'worst' as const : null) : null,
    }));
  }, [analysis.confirmations]);

  const topSession = useMemo(() => {
    if (analysis.sessions.length === 0) return null;
    return [...analysis.sessions].sort((a, b) => b.totalPnl - a.totalPnl)[0];
  }, [analysis.sessions]);

  const dirTotal = analysis.direction.long.trades + analysis.direction.short.trades;
  const longPct = dirTotal > 0 ? (analysis.direction.long.trades / dirTotal) * 100 : 0;
  const shortPct = dirTotal > 0 ? 100 - longPct : 0;

  const weekdayRows = useMemo(() => {
    const days = analysis.time.byWeekday;
    if (days.length === 0) return [];
    const byKey = new Map(days.map(g => [g.key, g]));
    const max = Math.max(1, ...days.map(g => g.winRate));
    // Full Sunday–Saturday spread, not just the days that happen to have trades —
    // an untraded day still needs to show up as an (empty) bar for the chart to
    // read as a real weekly distribution.
    return Array.from({ length: 7 }, (_, w) => {
      const g = byKey.get(String(w));
      return {
        key: String(w),
        trades: g?.trades ?? 0,
        heading: WEEKDAY_HE[w],
        pct: g ? (g.winRate / max) * 100 : 0,
        tone: (analysis.time.bestWeekday?.key === String(w) ? 'best' : analysis.time.worstWeekday?.key === String(w) ? 'worst' : 'mid') as 'best' | 'worst' | 'mid',
      };
    });
  }, [analysis.time]);

  const hourRows = useMemo(() => {
    const hours = analysis.time.byHour;
    if (hours.length === 0) return [];
    const byKey = new Map(hours.map(g => [Number(g.key), g]));
    const keys = hours.map(g => Number(g.key));
    const lo = Math.min(...keys), hi = Math.max(...keys);
    const max = Math.max(1, ...hours.map(g => g.winRate));
    // Fill every hour between the earliest and latest trade, not just the
    // hours that already have one — gaps inside the trading window should
    // read as zero, not disappear from the chart.
    return Array.from({ length: hi - lo + 1 }, (_, i) => {
      const h = lo + i;
      const g = byKey.get(h);
      return {
        key: String(h),
        trades: g?.trades ?? 0,
        label: `${String(h).padStart(2, '0')}:00`,
        pct: g ? (g.winRate / max) * 100 : 0,
        tone: (analysis.time.bestHour?.key === String(h) ? 'best' : analysis.time.worstHour?.key === String(h) ? 'worst' : 'mid') as 'best' | 'worst' | 'mid',
      };
    });
  }, [analysis.time]);

  const monthCount = analysis.time.byMonth.length;

  if (trades.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto" dir="rtl">
        <div className="px-8 max-[880px]:px-4 py-8 pb-24 max-w-4xl mx-auto">
          <EmptyState
            icon="◈"
            title="מעבדת המחקר שלך עדיין ריקה"
            description="ניתוח AI מלא — ביצועים, מכשירים, סשנים, אישורים ודפוסים חוזרים — ייבנה ברגע שיהיו לך עסקאות ביומן. תתחיל עם 3 עסקאות לפחות."
          />
        </div>
      </div>
    );
  }

  const p = analysis.performance;
  const bestInst = instrumentRows[0];
  const worstInst = instrumentRows[instrumentRows.length - 1];
  const bestConf = confirmationRows[0];
  const worstConf = confirmationRows[confirmationRows.length - 1];

  return (
    <div className="flex-1 overflow-y-auto" dir="rtl">
      {/* Topbar */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-5 px-6 sm:px-[clamp(24px,3.5vw,60px)] h-[60px] bg-[rgba(5,5,5,.82)] backdrop-blur-md border-b border-[#1c1c1e]">
        <h1 className="font-serif text-[17px] font-bold text-white">אנליטיקת AI · מרכז מודיעין</h1>
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-sm border border-[#d4af37]/28 bg-[#d4af37]/5">
          <span className="w-2 h-2 rounded-full bg-[#d4af37]" style={{ animation: 'onyx-dot-pulse 2.4s infinite' }} />
          <span className="font-mono text-[11.5px] font-bold text-[#d4af37] tracking-[0.1em]">
            {activeSession ? `סשן פעיל · ${SESSION_HE[activeSession]}` : 'אין סשן פעיל'}
          </span>
        </div>
      </div>

      <div className="max-w-[1500px] mx-auto w-full px-6 sm:px-[clamp(24px,3.5vw,60px)] pb-28">

        {/* ══════════ HERO ══════════ */}
        <section className="relative overflow-hidden pt-12 sm:pt-[clamp(48px,5.5vw,80px)]">
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(140% 120% at 88% 0%,rgba(212,175,55,.16),rgba(212,175,55,.05) 45%,transparent 80%)' }} />
          <div className="onyx-hero-sweep absolute inset-x-0 top-0 h-px pointer-events-none z-[2]" />
          <div className="relative">
            <Reveal className="grid grid-cols-1 min-[820px]:grid-cols-[clamp(240px,24vw,340px)_minmax(0,1fr)] gap-8 sm:gap-[clamp(32px,4vw,72px)] items-start mb-9 sm:mb-[clamp(38px,4vw,56px)]">
              <div className="text-right">
                <div className="flex items-center gap-2.5 mb-4"><span className="text-[#d4af37] text-sm">◈</span><span className="font-mono text-[11px] font-bold tracking-[0.3em] uppercase text-[#d4af37]">Onyx Intelligence</span></div>
                <h2 className="font-serif font-bold text-white leading-[0.96]" style={{ fontSize: 'clamp(40px,5.5vw,76px)' }}>
                  אנליטיקת <span style={{ color: '#d4af37', textShadow: '0 0 60px rgba(212,175,55,.4)' }}>AI</span>
                </h2>
              </div>
              <p className="font-medium text-[#c0c0c0] leading-[1.7] text-right pb-1" style={{ fontSize: 'clamp(15px,1.4vw,18px)' }}>
                ניתוח אוטומטי של יומן המסחר שלך. המערכת מזקקת מכל עסקה את הקצה — לפי מכשיר, סשן, כיוון וזמן — מזהה דפוסים חוזרים ומסכמת אותם לדוח שבועי, כדי שתדע בדיוק היכן הביצועים חזקים והיכן כדאי לחדד.
              </p>
            </Reveal>

            {/* Headline ledger strip */}
            <Reveal className="grid grid-cols-2 sm:grid-cols-4 bg-[#0a0a0b] border-y border-[#1c1c1e]">
              <div className="px-6 sm:px-[30px] py-[22px] sm:py-[28px] border-s border-[#1c1c1e]">
                <span className="block font-mono text-[13px] font-bold tracking-[0.1em] text-white/62 mb-4">רווח / הפסד כולל</span>
                <CountUp to={Math.abs(p.totalPnl)} prefix={p.totalPnl >= 0 ? '+$' : '-$'} className="font-mono font-extrabold leading-none" style={{ fontSize: 'clamp(30px,3.4vw,46px)', color: p.totalPnl >= 0 ? '#6fa580' : '#c98080', textShadow: `0 0 34px ${p.totalPnl >= 0 ? 'rgba(74,124,89,.4)' : 'rgba(139,58,58,.4)'}` }} />
              </div>
              <div className="px-6 sm:px-[30px] py-[22px] sm:py-[28px] border-s border-[#1c1c1e]">
                <span className="block font-mono text-[13px] font-bold tracking-[0.1em] text-white/62 mb-4">אחוז הצלחה</span>
                <CountUp to={p.winRate} decimals={1} suffix="%" className="font-mono font-extrabold leading-none" style={{ fontSize: 'clamp(30px,3.4vw,46px)', color: '#d4af37', textShadow: '0 0 34px rgba(212,175,55,.45)' }} />
              </div>
              <div className="px-6 sm:px-[30px] py-[22px] sm:py-[28px] border-s border-[#1c1c1e]">
                <span className="block font-mono text-[13px] font-bold tracking-[0.1em] text-white/62 mb-4">פרופיט פקטור</span>
                <CountUp to={p.profitFactor} decimals={2} className="font-mono font-extrabold leading-none" style={{ fontSize: 'clamp(30px,3.4vw,46px)', color: '#fff' }} />
              </div>
              <div className="px-6 sm:px-[30px] py-[22px] sm:py-[28px]">
                <span className="block font-mono text-[13px] font-bold tracking-[0.1em] text-white/62 mb-4">יחס R:R ממוצע</span>
                <CountUp to={p.avgRR} decimals={2} className="font-mono font-extrabold leading-none" style={{ fontSize: 'clamp(30px,3.4vw,46px)', color: '#fff' }} />
              </div>
            </Reveal>

            {/* Secondary context line */}
            <Reveal className="flex flex-wrap gap-x-7 gap-y-2.5 py-4 px-2 font-mono text-[13px] font-semibold text-white/55">
              <span>עסקאות סגורות <b className="num text-white">{p.closedTrades}</b></span>
              <span className="text-white/20">·</span>
              <span>סה״כ עסקאות <b className="num text-white">{p.totalTrades}</b></span>
              <span className="text-white/20">·</span>
              <span>רווח ממוצע <b className="num" style={{ color: '#6fa580' }}>${p.avgWinner.toFixed(0)}</b></span>
              <span className="text-white/20">·</span>
              <span>הפסד ממוצע <b className="num text-white/72">${p.avgLoser.toFixed(0)}</b></span>
            </Reveal>
          </div>
        </section>

        {/* ══════════ 01 · INSTRUMENT ══════════ */}
        <NumberedSection
          index={1} total={6} eyebrow="Instrument Edge" title="ניתוח לפי מכשיר"
          description={
            instrumentRows.length === 0 ? 'עדיין אין עסקאות סגורות למכשיר כלשהו.'
            : instrumentRows.length === 1 ? `כרגע יש נתונים רק על ${instrumentRows[0].key}.`
            : `${bestInst.key} מוביל עם הרווח הגבוה ביותר; ${worstInst.key} כרגע החלש מביניהם.`
          }
          extra={instrumentRows.length > 0 && (
            <span className="block font-mono text-[10.5px] font-bold text-white/38 tracking-[0.14em] mt-4">
              {instrumentRows.map(g => g.key).join(' · ')}
            </span>
          )}
        >
          {instrumentRows.length === 0 ? (
            <p className="text-sm text-white/30">אין עדיין מספיק נתונים.</p>
          ) : (
            <div>
              {instrumentRows.map(g => (
                <div key={g.key} className="grid gap-5 sm:gap-8 items-center py-[26px] border-b border-[#1c1c1e] last:border-0" style={{ gridTemplateColumns: '110px minmax(0,1fr) clamp(240px,26vw,320px)' }}>
                  <div className="text-right">
                    <span className="font-mono text-xl font-extrabold text-white tracking-[0.04em]">{g.key}</span>
                    {g.badge === 'best' && <span className="block w-fit mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#6fa580] border border-[#6fa580]/45 bg-[#6fa580]/12 px-2 py-0.5 rounded-sm">◆ מיטבי</span>}
                    {g.badge === 'worst' && <span className="block w-fit mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#c98080] border border-[#8b3a3a]/45 bg-[#8b3a3a]/12 px-2 py-0.5 rounded-sm">חלש ביותר</span>}
                  </div>
                  <div>
                    <HBar pct={g.pct} />
                    <div className="flex justify-between mt-2.5 font-mono text-[12.5px] font-bold text-white/50 tracking-[0.03em]">
                      <span>{g.trades} עסקאות · {g.winRate.toFixed(0)}% הצלחה</span>
                      <span className="num text-base font-extrabold" style={{ color: g.totalPnl >= 0 ? '#6fa580' : '#c98080' }}>{g.totalPnl >= 0 ? '+' : '-'}${Math.abs(g.totalPnl).toFixed(0)}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-0.5 text-center">
                    <div className="border-s border-[#1c1c1e]"><span className="block font-mono text-[13px] font-extrabold text-[#9a9aa2] tracking-[0.05em] mb-2">R:R</span><span className="num font-mono text-lg font-extrabold text-white">{g.avgRR.toFixed(2)}</span></div>
                    <div className="border-s border-[#1c1c1e]"><span className="block font-mono text-[13px] font-extrabold text-[#9a9aa2] tracking-[0.05em] mb-2">PF</span><span className="num font-mono text-lg font-extrabold text-[#d4af37]">{fmtPF(g.profitFactor)}</span></div>
                    <div><span className="block font-mono text-[13px] font-extrabold text-[#9a9aa2] tracking-[0.05em] mb-2">הצלחה</span><span className="num font-mono text-lg font-extrabold text-[#6fa580]">{g.winRate.toFixed(0)}%</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </NumberedSection>

        {/* ══════════ 02 · SESSION + DIRECTION ══════════ */}
        <NumberedSection
          index={2} total={6} eyebrow="Session &amp; Direction" title="סשן וכיוון"
          description="היכן הקצה חי — ולאיזה כיוון הוא נוטה."
        >
          {topSession ? (
            <div className="flex items-center justify-between gap-7 flex-wrap py-2 pb-8 border-b border-[#1c1c1e]">
              <div className="text-right">
                <div className="flex items-center gap-2.5 mb-3"><span className="w-2 h-2 rounded-full bg-[#d4af37]" style={{ animation: 'onyx-dot-pulse 2.4s infinite' }} /><span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#d4af37]">{analysis.sessions.length === 1 ? 'חלון המנצח היחיד' : 'הסשן החזק ביותר'}</span></div>
                <h4 className="font-serif font-extrabold text-white leading-none" style={{ fontSize: 'clamp(26px,3vw,38px)' }}>{SESSION_HE[topSession.key] ?? topSession.label}</h4>
                <p className="max-w-md mt-3 text-sm text-[#c0c0c0] leading-relaxed">
                  {topSession.trades} מתוך {p.totalTrades} העסקאות שלך נפתחו בסשן זה{analysis.sessions.length === 1 ? ' — הסשן היחיד שבו קיימת כרגע דגימה.' : `, עם ${topSession.winRate.toFixed(0)}% הצלחה.`}
                </p>
              </div>
              <div className="flex items-stretch">
                <div className="px-[28px] text-center border-s border-[#1c1c1e]"><span className="block font-mono text-sm font-extrabold text-[#9a9aa2] tracking-[0.08em] mb-3.5">עסקאות</span><span className="num font-mono text-white" style={{ fontSize: 42, fontWeight: 800 }}>{topSession.trades}</span></div>
                <div className="px-[28px] text-center border-s border-[#1c1c1e]"><span className="block font-mono text-sm font-extrabold text-[#9a9aa2] tracking-[0.08em] mb-3.5">הצלחה</span><span className="num font-mono" style={{ fontSize: 42, fontWeight: 800, color: '#d4af37', textShadow: '0 0 28px rgba(212,175,55,.4)' }}>{topSession.winRate.toFixed(0)}%</span></div>
                <div className="ps-[28px] text-center"><span className="block font-mono text-sm font-extrabold text-[#9a9aa2] tracking-[0.08em] mb-3.5">נטו</span><span className="num font-mono" style={{ fontSize: 42, fontWeight: 800, color: topSession.totalPnl >= 0 ? '#6fa580' : '#c98080' }}>{topSession.totalPnl >= 0 ? '+' : '-'}${Math.abs(topSession.totalPnl).toFixed(0)}</span></div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/30 pb-8 border-b border-[#1c1c1e]">אין עדיין עסקאות מתויגות עם סשן.</p>
          )}

          {dirTotal > 0 && (
            <div className="pt-8">
              <div className="flex items-baseline justify-between mb-5">
                <span className="font-mono text-sm font-extrabold text-white/66 tracking-[0.06em]">{analysis.direction.long.trades} לונג · {analysis.direction.short.trades} שורט</span>
                <span className="font-serif text-lg font-bold text-white">לונג מול שורט</span>
              </div>
              <div className="flex h-[70px] border border-[#1c1c1e] rounded-[3px] overflow-hidden">
                {longPct > 0 && (
                  <div className="flex flex-col justify-center px-6 border-e border-[#1c1c1e]" style={{ width: `${longPct}%`, background: 'linear-gradient(90deg,rgba(74,124,89,.32),rgba(74,124,89,.16))' }}>
                    <span className="font-mono text-[13px] font-extrabold uppercase tracking-[0.14em] mb-1.5" style={{ color: '#6fa580' }}>לונג · Long</span>
                    <div className="flex items-baseline gap-2.5 flex-wrap">
                      <span className="num font-mono text-2xl font-extrabold" style={{ color: '#6fa580' }}>{analysis.direction.long.winRate.toFixed(0)}%</span>
                      <span className="num font-mono text-[13px] font-bold text-white/60">{analysis.direction.long.trades} עסקאות · {analysis.direction.long.totalPnl >= 0 ? '+' : '-'}${Math.abs(analysis.direction.long.totalPnl).toFixed(0)} · R:R {analysis.direction.long.avgRR.toFixed(2)}</span>
                    </div>
                  </div>
                )}
                {shortPct > 0 && (
                  <div className="flex flex-col justify-center px-6 text-left" style={{ width: `${shortPct}%`, background: 'linear-gradient(90deg,rgba(139,58,58,.14),rgba(139,58,58,.28))' }}>
                    <span className="font-mono text-[13px] font-extrabold uppercase tracking-[0.14em] mb-1.5" style={{ color: '#c98080' }}>שורט · Short</span>
                    <div className="flex items-baseline gap-2">
                      <span className="num font-mono text-2xl font-extrabold" style={{ color: '#c98080' }}>{analysis.direction.short.winRate.toFixed(0)}%</span>
                      <span className="num font-mono text-xs font-bold text-white/55">{analysis.direction.short.trades} · {analysis.direction.short.totalPnl >= 0 ? '+' : '-'}${Math.abs(analysis.direction.short.totalPnl).toFixed(0)}</span>
                    </div>
                  </div>
                )}
              </div>
              <p className="mt-4 text-[13.5px] text-white/55 leading-relaxed text-right">
                {analysis.direction.long.winRate > analysis.direction.short.winRate
                  ? 'הקצה שלך נוטה לכיוון הלונג. שווה לבחון האם השורט בכלל שייך למודל.'
                  : analysis.direction.short.winRate > analysis.direction.long.winRate
                  ? 'הקצה שלך נוטה לכיוון השורט כרגע. שווה לתת לו יותר משקל.'
                  : 'לונג ושורט מציגים ביצועים דומים כרגע — עוד מוקדם לקבוע נטייה.'}
              </p>
            </div>
          )}
        </NumberedSection>

        {/* ══════════ 03 · TIME SIGNATURE ══════════ */}
        <NumberedSection
          index={3} total={6} eyebrow="Time Signature" title="חתימת זמן"
          description="מתי הביצועים בשיאם ומתי הם נחלשים — לפי יום בשבוע, שעה בסשן, וחודש."
        >
          <div>
            <div className="grid gap-9" style={{ gridTemplateColumns: (weekdayRows.length > 0 && hourRows.length > 0) ? '1fr 1fr' : '1fr' }}>
              {weekdayRows.length > 0 && (
                <div className={hourRows.length > 0 ? 'pe-7 border-e border-[#1c1c1e]' : ''}>
                  <div className="mb-5 text-right">
                    <span className="block font-mono text-base font-extrabold text-white/74">
                      {analysis.time.bestWeekday && <>חזק <b style={{ color: '#d4af37' }}>{WEEKDAY_HE[Number(analysis.time.bestWeekday.key)]}</b></>}
                      {analysis.time.worstWeekday && analysis.time.worstWeekday.key !== analysis.time.bestWeekday?.key && <> · חלש <b style={{ color: '#c98080' }}>{WEEKDAY_HE[Number(analysis.time.worstWeekday.key)]}</b></>}
                    </span>
                    <span className="block font-mono text-[13px] font-extrabold uppercase tracking-[0.14em] text-[#d4af37] mt-2">יום בשבוע</span>
                  </div>
                  <div className="grid gap-1.5 items-end h-[130px]" style={{ gridTemplateColumns: `repeat(${weekdayRows.length},1fr)` }}>
                    {weekdayRows.map(g => <VBar key={g.key} pct={g.pct} tone={g.tone} label={g.heading} />)}
                  </div>
                </div>
              )}
              {hourRows.length > 0 && (
                <div>
                  <div className="mb-5 text-right">
                    <span className="block font-mono text-base font-extrabold text-white/74">
                      {analysis.time.bestHour && <>שיא <b style={{ color: '#d4af37' }}>{analysis.time.bestHour.label}</b></>}
                      {analysis.time.worstHour && analysis.time.worstHour.key !== analysis.time.bestHour?.key && <> · שפל <b style={{ color: '#c98080' }}>{analysis.time.worstHour.label}</b></>}
                    </span>
                    <span className="block font-mono text-[13px] font-extrabold uppercase tracking-[0.14em] text-[#d4af37] mt-2">שעה · IDT</span>
                  </div>
                  <div className="flex gap-0.5 items-end h-[130px]">
                    {hourRows.map(g => <VBar key={g.key} pct={g.pct} tone={g.tone} label={g.label} />)}
                  </div>
                </div>
              )}
              {weekdayRows.length === 0 && hourRows.length === 0 && (
                <p className="text-sm text-white/30">אין עדיין מספיק נתונים לניתוח זמן.</p>
              )}
            </div>

            {analysis.time.bestMonth && (
              <div className="flex items-center justify-between gap-6 flex-wrap pt-8 mt-8 border-t border-[#1c1c1e]">
                <p className="max-w-md text-[13.5px] text-white/55 leading-relaxed text-right order-2">
                  {monthCount <= 1
                    ? 'כל העסקאות שלך רוכזו בחודש אחד. עדיין אין חודשים קודמים להשוואה — הדגימה החודשית תתמלא עם הזמן.'
                    : `מבין ${monthCount} חודשים בהם תעדת עסקאות, זה החודש החזק ביותר עד כה.`}
                </p>
                <div className="text-right order-1">
                  <span className="block font-mono text-sm font-extrabold uppercase tracking-[0.14em] text-[#9a9aa2] mb-3.5">החודש החזק ביותר</span>
                  <span className="block font-serif font-extrabold leading-none num" style={{ fontSize: 'clamp(30px,3.4vw,46px)', color: '#d4af37', textShadow: '0 0 34px rgba(212,175,55,.35)' }}>{analysis.time.bestMonth.key.replace('-', '·')}</span>
                  <span className="block font-mono text-sm font-extrabold text-white/66 tracking-[0.06em] mt-3">
                    {MONTH_HE[Number(analysis.time.bestMonth.key.slice(5, 7)) - 1]} · {analysis.time.bestMonth.trades} עסקאות · {analysis.time.bestMonth.totalPnl >= 0 ? '+' : '-'}${Math.abs(analysis.time.bestMonth.totalPnl).toFixed(0)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </NumberedSection>

        {/* ══════════ 04 · CONFIRMATION TAGS ══════════ */}
        <NumberedSection
          index={4} total={6} eyebrow="Confluence Tags" title="ניתוח אישורים"
          description={
            confirmationRows.length === 0 ? 'עדיין לא תיוגת עסקאות באישור/מודל ספציפי.'
            : confirmationRows.length === 1 ? `כרגע יש נתונים רק על "${confirmationRows[0].key}".`
            : `לפי תגית המודל/הסטאפ שסימנת בכל עסקה — "${bestConf.key}" נושא את הרווח; "${worstConf.key}" חלש יותר.`
          }
        >
          {confirmationRows.length === 0 ? (
            <p className="text-sm text-white/30">תייג עסקאות עם מודל/אישור בפלייבוק כדי לקבל ניתוח כאן.</p>
          ) : (
            <div>
              {confirmationRows.map(g => (
                <div key={g.key} className="grid gap-6 sm:gap-9 items-center py-6 border-b border-[#1c1c1e] last:border-0" style={{ gridTemplateColumns: 'minmax(0,1fr) clamp(200px,24vw,260px)' }}>
                  <div className="text-right">
                    <div className="flex items-center gap-2.5 mb-3"><span style={{ color: '#d4af37', fontSize: 11 }}>◈</span><span className="font-mono text-base font-bold text-white">{g.key}</span></div>
                    <HBar pct={g.pct} />
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="text-center"><span className="block font-mono text-[13px] font-extrabold text-[#9a9aa2] tracking-[0.05em] mb-2">עסקאות</span><span className="num font-mono text-[19px] font-extrabold text-white">{g.trades}</span></div>
                    <div className="text-center"><span className="block font-mono text-[13px] font-extrabold text-[#9a9aa2] tracking-[0.05em] mb-2">הצלחה</span><span className="num font-mono text-[19px] font-extrabold" style={{ color: '#6fa580' }}>{g.winRate.toFixed(0)}%</span></div>
                    <div className="text-center"><span className="block font-mono text-[13px] font-extrabold text-[#9a9aa2] tracking-[0.05em] mb-2">נטו</span><span className="num font-mono text-[19px] font-extrabold" style={{ color: g.totalPnl >= 0 ? '#6fa580' : '#c98080' }}>{g.totalPnl >= 0 ? '+' : '-'}${Math.abs(g.totalPnl).toFixed(0)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </NumberedSection>

        {/* ══════════ 05 · PATTERN DETECTION ══════════ */}
        <NumberedSection
          index={5} total={6} eyebrow="AI · Pattern Detection" title="גילוי דפוסים"
          description="המנוע קורא את היומן ומזהה דפוסים חוזרים — כל דפוס מסומן ברמת ביטחון לפי גודל הדגימה."
        >
          {patternsLoading ? (
            <div className="flex items-center gap-2.5 py-6"><TypingDots /><span className="text-sm text-white/30">מאתר דפוסים...</span></div>
          ) : patternInsights.length === 0 ? (
            <p className="text-sm text-white/30 py-2">אין עדיין מספיק נתונים היסטוריים כדי לגלות דפוס מובהק.</p>
          ) : (
            <div className="grid gap-px bg-[#1c1c1e] border border-[#1c1c1e] rounded-[4px] overflow-hidden">
              {patternInsights.map((ins, i) => (
                <Reveal key={i} className="bg-[#0a0a0b] p-6">
                  <div className="flex items-center justify-between gap-4 flex-wrap mb-3.5">
                    <ConfidenceBadge level={ins.confidenceLevel} sampleSize={ins.sampleSize} />
                    <div className="flex items-center gap-2"><span className="font-mono text-sm font-bold text-white">{ins.subject}</span><span style={{ color: '#d4af37', fontSize: 12 }}>◈</span></div>
                  </div>
                  <InsightText text={ins.title + ' ' + ins.evidence} className="text-[15px] font-medium text-[#c0c0c0] leading-relaxed" />
                </Reveal>
              ))}
            </div>
          )}
        </NumberedSection>

        {/* ══════════ 06 · WEEKLY REPORT ══════════ */}
        <NumberedSection
          index={6} total={6} eyebrow="AI · Weekly Report" title="דוח שבועי"
          description="תמצית שבעת הימים האחרונים — חוזק, חולשה ומיקוד לשבוע הבא."
          extra={weeklyReport && <div className="mt-4"><ConfidenceBadge level={weeklyReport.confidenceLevel} sampleSize={weeklyReport.sampleSize} /></div>}
        >
          {weeklyLoading ? (
            <div className="flex items-center gap-2.5 py-6"><TypingDots /><span className="text-sm text-white/30">מכין את הדוח השבועי...</span></div>
          ) : !weeklyReport ? (
            <p className="text-sm text-white/30 py-2">אין עדיין מספיק נתונים היסטוריים כדי לייצר תובנה ברמת ביטחון גבוהה.</p>
          ) : (
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-[#1c1c1e] border border-[#1c1c1e] rounded-[4px] overflow-hidden">
                {[
                  { k: 'החוזק הגדול ביותר', v: weeklyReport.biggestStrength, dot: '#6fa580' },
                  { k: 'החולשה הגדולה ביותר', v: weeklyReport.biggestWeakness, dot: '#c98080' },
                  { k: 'השיפור הגדול ביותר', v: weeklyReport.largestImprovement, dot: '#7a8fa8' },
                  { k: 'הירידה הגדולה ביותר', v: weeklyReport.largestDecline, dot: '#52525b' },
                ].map(row => (
                  <div key={row.k} className="bg-[#0a0a0b] p-6">
                    <div className="flex items-center gap-2 mb-3"><span className="w-1.5 h-1.5 rounded-full" style={{ background: row.dot }} /><span className="font-mono text-xs font-extrabold tracking-[0.08em]" style={{ color: row.dot }}>{row.k}</span></div>
                    <InsightText text={row.v} className="text-sm font-medium text-[#c0c0c0] leading-relaxed" />
                  </div>
                ))}
              </div>

              <Reveal className="mt-6 p-6 sm:p-7 rounded-[6px]" style={{ border: '1px solid rgba(212,175,55,.3)', background: 'radial-gradient(120% 140% at 100% 0%,rgba(212,175,55,.08),transparent 60%)', boxShadow: '0 0 50px -20px rgba(212,175,55,.4)' }}>
                <div className="flex items-center gap-2.5 mb-3"><span style={{ color: '#d4af37', fontSize: 14 }}>◈</span><span className="font-mono text-xs font-extrabold uppercase tracking-[0.14em] text-[#d4af37]">המיקוד לשבוע הבא</span></div>
                <InsightText text={weeklyReport.focusNextWeek} className="text-base font-semibold text-white leading-relaxed" />
              </Reveal>

              <div className="mt-8 pt-6 border-t border-[#1c1c1e] flex items-center justify-between gap-4 flex-wrap">
                <span className="font-mono text-xs font-semibold text-[#52525b]">
                  {reportHistory.length === 0 ? 'אין עדיין דוחות קודמים — הארכיון יתמלא שבוע אחר שבוע.' : `${reportHistory.length} דוחות בארכיון.`}
                </span>
                {reportHistory.length > 0 && (
                  <button onClick={() => setShowHistory(v => !v)} className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/45 hover:text-[#d4af37] transition-colors">
                    {showHistory ? 'הסתר' : 'גיליונות קודמים'}
                  </button>
                )}
              </div>
              {showHistory && (
                <div className="mt-4 flex flex-col gap-2.5 onyx-reveal">
                  {reportHistory.map(h => (
                    <div key={h.weekKey} className="rounded-lg bg-[#0a0a0b] border border-white/5 p-3.5 flex items-start gap-3">
                      <span className="font-mono text-[9px] text-white/30 shrink-0 mt-0.5" dir="ltr">{h.weekKey}</span>
                      <InsightText text={h.report.biggestStrength} className="text-xs text-white/55 leading-relaxed" />
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-10 font-mono text-[11.5px] font-semibold text-[#52525b] leading-loose text-right">
                אנליטיקת ה-AI היא רק עוד נקודת מבט של המערכת על היומן שלך — תמיד מומלץ להפעיל שיקול דעת עצמאי משלך. המסחר כרוך בסיכון משמעותי.
              </p>
            </div>
          )}
        </NumberedSection>

      </div>
    </div>
  );
}
