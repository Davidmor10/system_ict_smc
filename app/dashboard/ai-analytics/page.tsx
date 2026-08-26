'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadTrades, todayISO } from '../../lib/journal';
import type { TradeEntry } from '../../lib/journal';
import { runFullAnalysis, isoWeekKey, simulate, availableScenarios, timedTradeCount, hourScenario, ruleScenarios,
  closestToSignificance, sampleNeededFor, PATTERN_ALPHA } from '../../lib/analytics';
import type { ConfidenceLevel, GroupPerformance, WhatIfScenario, ScenarioKind, RuleForWhatIf } from '../../lib/analytics';
import { SESS, getActiveSessionKey } from '../../lib/sessions';
import EmptyState from '../../components/EmptyState';
import PatternEvidence from '../../components/PatternEvidence';
import InsightText from '../../components/InsightText';
import TypingDots from '../../components/TypingDots';
import WeeklyTabs from '../../components/WeeklyTabs';
import TrackingArchive from '../../components/TrackingArchive';
import { readInsightCache, tradesFingerprint, writeInsightCache } from '../../lib/ai/insightCache';

/** Mirror app/lib/ai/patternInsights.ts and app/lib/intelligence/service.ts's
    return shapes as local types (not imported) so this client component
    never pulls in server-only AI SDK / Supabase modules. */
// The shape the route returns. Kept in step with lib/ai/patternInsights.ts —
// a local copy that drifts is how a field silently stops rendering.
interface PatternInsight {
  subject: string; title: string; evidence: string;
  confidenceLevel: ConfidenceLevel; sampleSize: number;
  delta: number; significant: boolean;
  /** The trades the slice selected, so the card can be opened. Optional here
   *  and only here: an insight cached by an older build has no such field, and
   *  a missing toggle is a better outcome than a page that throws. */
  tradeIds?: number[];
}

function fmtPF(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '∞';
}

const SESSION_HE: Record<string, string> = Object.fromEntries(SESS.map(s => [s.key, s.he]));
const DIRECTION_HE: Record<string, string> = { LONG: 'לונג', SHORT: 'שורט' };
const EMOTION_HE: Record<string, string> = {
  CALM: 'רגוע', CONFIDENT: 'בטוח', STRESSED: 'לחוץ', FOMO: 'FOMO', TIRED: 'עייף', ANGRY: 'כועס', IMPATIENT: 'חסר סבלנות',
};
const CONFIRMATION_LABELS: Record<string, string> = { ORDER_BLOCK: 'Order Block' };
const confLabel = (key: string) => CONFIRMATION_LABELS[key] ?? key;
const MONTH_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const CONF_LABEL: Record<ConfidenceLevel, string> = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
const CONF_META: Record<ConfidenceLevel, { fg: string; bg: string; bd: string }> = {
  low:    { fg: '#d4af37', bg: 'rgba(212,175,55,.08)', bd: 'rgba(212,175,55,.4)' },
  medium: { fg: '#6fa580', bg: 'rgba(74,124,89,.08)',  bd: 'rgba(74,124,89,.4)'  },
  high:   { fg: '#6fa580', bg: 'rgba(74,124,89,.14)',  bd: 'rgba(74,124,89,.6)'  },
};

/** Small win-rate-over-time trend chart from the pattern's own rolling history
    (already tracked server-side across visits) — a genuine "did this improve
    or fade" chart, never a single-session guess. Skipped entirely when fewer
    than 3 snapshots exist, so it never renders a flat, meaningless line. */
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
function VBar({ pct, tone, label, labelSize = 11.5 }: { pct: number; tone: 'best' | 'worst' | 'mid'; label: string; labelSize?: number }) {
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
      <span className="font-mono" style={{ fontSize: labelSize, fontWeight: weight, color }}>{label}</span>
    </div>
  );
}

function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const m = CONF_META[level];
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] px-2.5 py-1 rounded-sm shrink-0"
      style={{ color: m.fg, background: m.bg, border: `1px solid ${m.bd}` }}
    >
      ביטחון {CONF_LABEL[level]}
    </span>
  );
}

/** One breakdown row — a labelled bar on the start side, trades/win-rate/net
    stat cells on the end side. Shared by the confirmation-tag, combo and
    emotion sections so they read identically. */
function StatRow({ label, ltr, g }: { label: string; ltr?: boolean; g: GroupPerformance & { pct: number } }) {
  return (
    <div className="grid gap-6 sm:gap-9 items-center py-[22px] border-b border-[#1c1c1e] last:border-0" style={{ gridTemplateColumns: 'minmax(0,1fr) clamp(200px,24vw,260px)' }}>
      <div className="text-right">
        <div className="flex items-center gap-2.5 mb-3"><span style={{ color: '#d4af37', fontSize: 11 }}>◈</span><span className="font-mono text-base font-bold text-white" dir={ltr ? 'ltr' : 'rtl'}>{label}</span></div>
        <HBar pct={g.pct} />
      </div>
      <div className="flex justify-between items-center">
        <div className="text-center"><span className="block font-mono text-[13px] font-extrabold text-[#9a9aa2] tracking-[0.05em] mb-2">עסקאות</span><span className="num font-mono text-[19px] font-extrabold text-white">{g.trades}</span></div>
        <div className="text-center"><span className="block font-mono text-[13px] font-extrabold text-[#9a9aa2] tracking-[0.05em] mb-2">הצלחה</span><span className="num font-mono text-[19px] font-extrabold" style={{ color: '#6fa580' }}>{g.winRate.toFixed(0)}%</span></div>
        <div className="text-center"><span className="block font-mono text-[13px] font-extrabold text-[#9a9aa2] tracking-[0.05em] mb-2">נטו</span><span className="num font-mono text-[19px] font-extrabold" style={{ color: g.totalPnl >= 0 ? '#6fa580' : '#c98080' }}>{g.totalPnl >= 0 ? '+' : '-'}${Math.abs(g.totalPnl).toFixed(0)}</span></div>
      </div>
    </div>
  );
}

/** One labelled stat tile for the exit-management grid. */
function ExitTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-[#0a0a0b] px-5 py-6">
      <span className="block font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-white/45 mb-3">{label}</span>
      <span className="num font-mono font-extrabold leading-none" style={{ fontSize: 'clamp(26px,2.6vw,34px)', color: color ?? '#fff' }}>{value}</span>
      {sub && <span className="block font-mono text-[11px] font-semibold text-white/40 mt-2.5">{sub}</span>}
    </div>
  );
}

/** The band that introduces a group of sections with the question it answers.
 *
 *  The page used to be ten numbered sections in the order they were built, so
 *  a corrected pattern finding and a raw weekday breakdown sat at the same
 *  visual rank and read as equally load-bearing. They are not: one survived a
 *  test and the other is a distribution.
 *
 *  Grouping by QUESTION rather than by data source is what fixes that. It also
 *  gives the orientation-only bands somewhere honest to live — `muted` renders
 *  them a rank down, so "here is where your trades sit" never again looks like
 *  "here is what works". */
/** The verdict a band's answer carries, which decides its colour.
 *
 *  Not decoration. It is the only part of the answer that reads before the
 *  sentence does, and on a page a trader scans rather than reads it is often
 *  the only part that reads at all. `none` is for an answer that is neither
 *  good nor bad — "not yet, and here is why" is an honest state, not a
 *  failure, and colouring it red would say otherwise. */
type BandTone = 'good' | 'warn' | 'none';

const TONE: Record<BandTone, { rail: string; label: string }> = {
  good: { rail: '#6fa580', label: '#6fa580' },
  warn: { rail: '#d4af37', label: '#d4af37' },
  none: { rail: '#3f3f46', label: 'rgba(255,255,255,0.42)' },
};

function QuestionBand({ n, question, body, answer, tone = 'none', muted }: {
  n: string; question: string; body: string; answer?: string; tone?: BandTone; muted?: boolean;
}) {
  const accent = muted ? '#52525b' : '#d4af37';
  const t = TONE[tone];
  return (
    <section className="border-t border-[#1c1c1e]" style={{ padding: 'clamp(46px,4.5vw,74px) 0 clamp(6px,1vw,14px)' }}>
      <Reveal className="text-right">
        {/* The marker goes on its own line, exactly where every section puts
            its "04 / 12". Inline beside the question it landed after the
            question mark in RTL and read as a stray character left behind
            rather than as a label. */}
        <div className="font-mono text-xs font-bold tracking-[0.28em] mb-4" style={{ color: accent }} dir="ltr">
          {n}
        </div>
        <h2
          className="font-serif font-bold leading-tight"
          style={{ fontSize: muted ? 'clamp(20px,2vw,26px)' : 'clamp(28px,3vw,40px)', color: muted ? 'rgba(255,255,255,0.62)' : '#fff' }}
        >
          {question}
        </h2>

        {/* The answer is built to look like a DIFFERENT KIND OF THING.
            
            It used to be the same serif face as the question, one size down —
            which reads as a subtitle, not as a reply. Question and answer blur
            into one block and the reader has to parse the sentence to work out
            which is which.
            
            Three separations now do the work, and each carries meaning rather
            than shape: the sans face against the question's serif, so the
            faces themselves say "this is a different voice"; a panel with a
            coloured rail, so it reads as an object placed under the question
            rather than more of the question; and the rail's colour, which is
            the verdict — the part that reads before the sentence does. */}
        {answer && (
          <div
            className="mt-5 flex overflow-hidden"
            style={{ maxWidth: '68ch', background: '#0d0d0f', border: '1px solid #1c1c1e', borderRadius: 2 }}
          >
            <div style={{ width: 2, background: t.rail, flex: '0 0 auto' }} />
            <div className="px-5 py-4" style={{ minWidth: 0 }}>
              <div
                className="font-mono font-bold mb-2"
                style={{ fontSize: 10.5, letterSpacing: '0.22em', color: t.label }}
              >
                ◈ התשובה
              </div>
              <p
                className="leading-relaxed"
                style={{ fontSize: 'clamp(15px,1.45vw,17.5px)', fontWeight: 500, color: 'rgba(255,255,255,0.92)' }}
              >
                {answer}
              </p>
            </div>
          </div>
        )}

        {/* Method, and clearly third. Small, grey, and below the answer rather
            than between it and the question. */}
        <p className="mt-4 text-[13px] text-white/38 leading-relaxed" style={{ maxWidth: '62ch' }}>{body}</p>
      </Reveal>
    </section>
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
  const [whatIfId, setWhatIfId] = useState<string | null>(null);
  const [hourStartMin, setHourStartMin] = useState<number | null>(null);
  const [rules, setRules] = useState<{ id: string; text: string }[]>([]);
  const [violations, setViolations] = useState<{ ruleId: string; date: string }[]>([]);

  useEffect(() => {
    setTrades(loadTrades());
    // Rules + their per-day violations power the "חוקים" what-if scenarios.
    try { const r = localStorage.getItem('onyx_trading_rules'); if (r) setRules((JSON.parse(r) as { id: string; text: string; deleted?: boolean }[]).filter(x => !x.deleted)); } catch { /* ignore */ }
    try { const v = localStorage.getItem('onyx_rule_violations'); if (v) setViolations((JSON.parse(v) as { ruleId: string; date: string; deleted?: boolean }[]).filter(x => !x.deleted)); } catch { /* ignore */ }
  }, []);

  const analysis = useMemo(() => runFullAnalysis(trades), [trades]);
  // Identifies the journal every AI-phrased panel on this page describes, so
  // their caches expire when the trades change and not merely at midnight.
  const fingerprint = useMemo(() => tradesFingerprint(trades), [trades]);
  const hasEnoughData = trades.filter(t => t.result !== 'OPEN').length >= 3;

  // The depth layer, now that runFullAnalysis carries it. Read here rather
  // than recomputed so this page and the coach cannot disagree about what a
  // trade is worth.
  const exp  = analysis.expectancy;
  const pve  = analysis.planVsExecution;
  const comp = analysis.completeness;

  /** Which half of the expectancy the trader should actually work on.
   *
   *  Stated as a reading of the decomposition rather than as advice: the same
   *  expectancy reached two ways calls for opposite work, and naming which way
   *  it was reached is the whole value of showing the parts. */
  const expectancyRead = useMemo(() => {
    if (exp.trades === 0) return '';
    const wr = exp.winRate * 100;
    const payoff = exp.avgLossR !== 0 ? Math.abs(exp.avgWinR / exp.avgLossR) : Infinity;
    const verdict = exp.expectancyUsd >= 0 ? 'חיובית' : 'שלילית';
    const head = `כרגע התוחלת שלך ${verdict}: כל עסקה שווה בממוצע ${exp.expectancyUsd >= 0 ? '' : 'מינוס '}$${Math.abs(exp.expectancyUsd).toFixed(0)}.`;
    if (wr >= 55 && payoff < 1.2) {
      return `${head} אתה צודק ברוב הפעמים (${Math.round(wr)}%) אבל המנצח הממוצע שלך קרוב בגודלו למפסיד — כלומר המקום להסתכל בו הוא היציאות, לא הכניסות.`;
    }
    if (wr < 45 && payoff >= 1.8) {
      // payoff is Infinity when there are no losers at all — a real state for a
      // short history, and "פי Infinity" is not a sentence.
      const ratio = Number.isFinite(payoff) ? `פי ${payoff.toFixed(1)}` : 'הרבה יותר';
      return `${head} אתה צודק בפחות ממחצית הפעמים (${Math.round(wr)}%) אבל כשאתה צודק אתה מוציא ${ratio} ממה שאתה משלם — כלומר המקום להסתכל בו הוא בחירת הכניסות, לא היציאות.`;
    }
    return `${head} אחוז הצלחה ${Math.round(wr)}%, ויחס של פי ${Number.isFinite(payoff) ? payoff.toFixed(1) : '∞'} בין המנצח הממוצע למפסיד הממוצע. אין כאן צד אחד שבולט כחלש — שני החלקים תורמים לתוצאה במידה דומה.`;
  }, [exp]);

  /** The one-line answer each band opens with.
   *
   *  Computed, never phrased by a model, and allowed to say "not yet" — a
   *  band whose question cannot be answered has to say so in the same place it
   *  would have put an answer, or the reader is left deciding whether the
   *  feature is empty or broken. */
  const bandAnswers = useMemo(() => {
    const closed = exp.trades;

    // A — profitable, and why.
    let a: string; let aTone: BandTone = 'none';
    if (closed === 0) {
      a = 'עדיין אין עסקאות סגורות, אז אין תוחלת לחשב.';
    } else {
      aTone = exp.expectancyUsd > 0 ? 'good' : exp.expectancyUsd < 0 ? 'warn' : 'none';
      const per = exp.expectancyUsd;
      const dir = per > 0 ? 'כן' : per < 0 ? 'לא' : 'בדיוק באיזון';
      a = `${dir} — כל עסקה שווה לך בממוצע ${per >= 0 ? '' : 'מינוס '}$${Math.abs(per).toFixed(0)}, על פני ${closed} עסקאות שנסגרו.`;
    }

    // B — doing what you said.
    let b: string; let bTone: BandTone = 'none';
    if (pve.measured === 0) {
      b = `אי אפשר לענות עדיין: אף עסקה לא נושאת גם תוכנית וגם מחיר יציאה${pve.assumed > 0 ? `, ול-${pve.assumed} מהן יש תוצאה בלי מחיר יציאה` : ''}.`;
    } else {
      const cap = pve.captureRate === null ? null : Math.round(pve.captureRate * 100);
      bTone = cap === null ? 'none' : cap >= 90 ? 'good' : 'warn';
      b = cap === null
        ? `נמדדו ${pve.measured} עסקאות, אבל עדיין אין מספיק עסקאות רווחיות כדי לחשב כמה מהיעד אתה לוקח.`
        : cap >= 90
          ? `כן — אתה לוקח ${cap}% מהיעד שתכננת, על ${pve.measured} עסקאות שנמדדו.`
          : `לא לגמרי — בעסקאות שהרוויחו לקחת בממוצע ${cap}% מהיעד שקבעת מראש. נמדד על ${pve.measured} עסקאות שיש בהן גם תוכנית וגם מחיר יציאה.`;
    }

    // C — is any of it real.
    const sig = analysis.patterns.filter(p => p.significant);
    const tested = analysis.patterns.length;
    let c: string; let cTone: BandTone = 'none';
    if (tested === 0) {
      c = 'עדיין אין מספיק עסקאות כדי לחתוך את ההיסטוריה ולבדוק משהו.';
    } else if (sig.length === 0) {
      // "Nothing found" on its own is useless — it does not tell the trader
      // whether to keep watching or drop the idea. The closest candidate and
      // the size of its remaining gap do.
      const near = closestToSignificance(analysis.patterns);
      const run  = analysis.patternRun;
      const need = near
        ? sampleNeededFor(
            near,
            { wins: run.allWins - near.metric.wins, losses: run.allLosses - near.metric.losses },
            run.comparisons,
            PATTERN_ALPHA,
          )
        : null;

      if (near && need) {
        c = `עדיין לא, אבל יש כיוון: ${near.metric.winRate.toFixed(0)}% הצלחה מול ${near.baseline.toFixed(0)}% בשאר היומן, על ${near.metric.trades} עסקאות. `
          + `אם הקצב הזה יישאר, בערך ${need.totalDecided} עסקאות סגורות ביומן יספיקו כדי לקבוע — עוד ${need.additional} בערך.`;
      } else if (near) {
        c = `עדיין לא. הכי קרוב הוא ${near.metric.winRate.toFixed(0)}% מול ${near.baseline.toFixed(0)}% על ${near.metric.trades} עסקאות, `
          + `אבל הפער קטן מכדי להיסגר בעוד עסקאות — עוד מהן ישאירו אותו במקום.`;
      } else {
        c = `בדקנו ${tested} צירופים שונים של תנאים ואף אחד לא החזיק. עדיין אין כאן משהו שנבדל ממקרה.`;
      }
    } else {
      // Deliberately not naming them here. The Hebrew labeller lives in the
      // AI module, which drags the provider client into a page bundle that has
      // no business holding it — and the section below names them anyway.
      cTone = 'good';
      c = `כן — ${sig.length} מתוך ${tested} הצירופים שנבדקו החזיקו גם אחרי שלקחנו בחשבון כמה בדיקות נעשו. הם מפורטים למטה.`;
    }

    return { a, b, c, aTone, bTone, cTone };
  }, [exp, pve, analysis]);
  const activeSession = getActiveSessionKey();

  // ── Pattern insights (AI-phrased, cached per day) ──
  useEffect(() => {
    if (!hasEnoughData) { setPatternInsights([]); return; }
    // v2: the evidence line stopped being model prose and became computed
    // text. Rows cached under the old key hold the English sentences that
    // change replaced, so they are left behind rather than shown until midnight.
    // v3: keyed by the trades it describes as well as the day. Under a
    // date-only key, deleting or editing a trade left the morning's rows on
    // screen describing a journal that no longer exists.
    // v4: the build id is part of the key. Under v3 the key moved only when
    // the day or the trades changed, so a deploy that changed the WORDING left
    // the previous wording cached in the browser of anyone who had already
    // opened the page that day — and the page, finding a cache hit, never
    // asked the server what it now said. That is how an English phrasing
    // survived the deploy that removed it.
    const cachePrefix = `onyx_ai_patterns_v4_${process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'}_`;
    const cacheKey = cachePrefix + todayISO();
    const cached = readInsightCache<PatternInsight[]>(cacheKey, fingerprint);
    if (cached && Array.isArray(cached.value)) { setPatternInsights(cached.value); return; }
    setPatternsLoading(true);
    fetch('/api/ai/pattern-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No trades in the body: the route reads them from this account's rows.
      // Posting a client-side copy meant the answer could describe a journal
      // that no longer matched the database.
      body: JSON.stringify({ lang: 'he' }),
    })
      .then(r => r.json())
      .then(({ insights }) => {
        if (Array.isArray(insights)) {
          setPatternInsights(insights);
          writeInsightCache(cacheKey, cachePrefix, fingerprint, insights, new Date().toISOString());
        }
      })
      .catch(() => {})
      .finally(() => setPatternsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);



  // Weekly-report fetching + history archive moved into WeeklyReportPanel
  // (self-contained component with its own state + cache + DB-backed history).

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

  // Confirmation-tag / combo / emotion breakdowns rank by sample size (most
  // frequent first) and fill their bars by win-rate share — PnL sign is less
  // meaningful for these slices than "how often, and how well".
  const barRowsByWinRate = (groups: GroupPerformance[]) => {
    const sorted = [...groups].sort((a, b) => b.trades - a.trades);
    const max = Math.max(1, ...sorted.map(g => g.winRate));
    return sorted.map(g => ({ ...g, pct: (g.winRate / max) * 100 }));
  };
  const confirmationTagRows = useMemo(() => barRowsByWinRate(analysis.confirmationTags), [analysis.confirmationTags]);
  const comboRows = useMemo(() => barRowsByWinRate(analysis.confirmationCombos), [analysis.confirmationCombos]);
  const emotionRows = useMemo(() => barRowsByWinRate(analysis.emotions), [analysis.emotions]);
  const exits = analysis.exits;

  // What-if simulator — scenarios meaningful for this journal, plus the user's
  // own custom 1-hour window (built on the fly from the picker below).
  const rulesForWhatIf = useMemo<RuleForWhatIf[]>(
    () => rules.map(r => ({ id: r.id, text: r.text, violationDates: violations.filter(v => v.ruleId === r.id).map(v => v.date) })),
    [rules, violations],
  );
  const ruleTextById = useMemo(() => new Map(rules.map(r => [r.id, r.text])), [rules]);
  const baseScenarios = useMemo(
    () => [...availableScenarios(trades), ...ruleScenarios(trades, rulesForWhatIf)],
    [trades, rulesForWhatIf],
  );
  const hourCapable = useMemo(() => timedTradeCount(trades) >= 2, [trades]);
  const customHour = hourStartMin != null ? hourScenario(hourStartMin) : null;
  const scenarios = customHour ? [...baseScenarios, customHour] : baseScenarios;
  const selectedScenario = scenarios.find(s => s.id === whatIfId) ?? null;
  const whatIf = useMemo(
    () => (selectedScenario ? simulate(trades, selectedScenario.predicate) : null),
    [trades, selectedScenario],
  );
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const fmtMin = (m: number) => `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
  const scenarioLabel = (s: WhatIfScenario): string => {
    switch (s.kind) {
      case 'excludeEmotion': return `בלי ${EMOTION_HE[s.value] ?? s.value}`;
      case 'onlyEmotion': return EMOTION_HE[s.value] ?? s.value;
      case 'onlyNoEmotion': return 'בלי רגש מסומן';
      case 'onlySession': return SESSION_HE[s.value] ?? s.value;
      case 'onlySymbol': return s.value;
      case 'onlySetup': return s.value;
      case 'onlyDirection': return DIRECTION_HE[s.value] ?? s.value;
      case 'onlyBiasAligned': return 'מיושר עם הביאס';
      case 'onlyConfirmation': return `עם ${confLabel(s.value)}`;
      case 'cleanRuleDays': return 'ימים ללא הפרות';
      case 'excludeRuleDay': return `בלי ימים שהפרת: ${ruleTextById.get(s.value) ?? ''}`;
      case 'onlyHour': { const m = Number(s.value); return `${fmtMin(m)}–${fmtMin((m + 60) % 1440)}`; }
      default: return s.value;
    }
  };
  // Grouping of scenario pills by dimension — the panel reads as a tailored list.
  const SCENARIO_GROUP: Record<ScenarioKind, string> = {
    onlyDirection: 'כיוון', onlySymbol: 'נכס', onlySetup: 'סטאפ', onlySession: 'סשן',
    onlyEmotion: 'רגש', excludeEmotion: 'רגש', onlyNoEmotion: 'רגש',
    cleanRuleDays: 'חוקים', excludeRuleDay: 'חוקים',
    onlyConfirmation: 'אישור', onlyBiasAligned: 'ביאס', onlyHour: 'שעה',
  };
  const GROUP_ORDER = ['כיוון', 'נכס', 'סטאפ', 'סשן', 'שעה', 'רגש', 'חוקים', 'אישור', 'ביאס'];

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
      <div
        className="flex-1 overflow-y-auto"
        dir="rtl"
        style={{
          background: `
            radial-gradient(60% 70% at 0% 20%, rgba(212,175,55,0.05), transparent 72%),
            radial-gradient(60% 70% at 100% 15%, rgba(122,143,168,0.045), transparent 72%),
            radial-gradient(55% 65% at 0% 85%, rgba(122,143,168,0.035), transparent 70%),
            radial-gradient(55% 65% at 100% 90%, rgba(212,175,55,0.04), transparent 70%),
            radial-gradient(70% 50% at 50% 100%, rgba(212,175,55,0.03), transparent 72%),
            #050505
          `,
        }}
      >
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
    <div
      className="flex-1 overflow-y-auto"
      dir="rtl"
      style={{
        background: `
          radial-gradient(60% 70% at 0% 20%, rgba(212,175,55,0.05), transparent 72%),
          radial-gradient(60% 70% at 100% 15%, rgba(122,143,168,0.045), transparent 72%),
          radial-gradient(55% 65% at 0% 85%, rgba(122,143,168,0.035), transparent 70%),
          radial-gradient(55% 65% at 100% 90%, rgba(212,175,55,0.04), transparent 70%),
          radial-gradient(70% 50% at 50% 100%, rgba(212,175,55,0.03), transparent 72%),
          #050505
        `,
      }}
    >
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

      <div className="max-w-[2000px] mx-auto w-full px-6 sm:px-[clamp(24px,3.5vw,60px)] pb-28">

        {/* ══════════ HERO ══════════ */}
        <section className="relative overflow-hidden pt-12 sm:pt-[clamp(48px,5.5vw,80px)]">
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


        <QuestionBand
          n="A" question="האם אני רווחי — ולמה?" answer={bandAnswers.a} tone={bandAnswers.aTone}
          body="המספר לבדו לא אומר מה לתקן. הפירוק כן: אותה תוחלת יכולה להיווצר משתי דרכים הפוכות: הרבה עסקאות רווחיות קטנות, או מעט עסקאות רווחיות גדולות. כל אחת מהן דורשת תיקון אחר לגמרי."
        />

        {/* ══════════ EXPECTANCY ══════════ */}
        <NumberedSection
          index={1} total={12} eyebrow="Expectancy" title="מה שווה לך עסקה"
          description={
            exp.trades === 0
              ? 'צריך עסקאות סגורות כדי לחשב תוחלת.'
              : 'כמה דולרים, בממוצע, שווה לך עסקה אחת — ומאיפה המספר הזה מגיע.'
          }
        >
          {exp.trades === 0 ? (
            <p className="text-sm text-white/30">אין עדיין עסקאות שנסגרו.</p>
          ) : (
            <div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#1c1c1e] border border-[#1c1c1e] rounded-[4px] overflow-hidden">
                <ExitTile
                  label="תוחלת לעסקה"
                  value={`${exp.expectancyUsd >= 0 ? '+' : '-'}$${Math.abs(exp.expectancyUsd).toFixed(0)}`}
                  sub={`${exp.expectancyR >= 0 ? '+' : ''}${exp.expectancyR.toFixed(2)}R · ${exp.trades} עסקאות`}
                  color={exp.expectancyUsd >= 0 ? '#6fa580' : '#c98080'}
                />
                <ExitTile
                  label="אחוז הצלחה"
                  value={`${Math.round(exp.winRate * 100)}%`}
                  sub="מהעסקאות שנסגרו"
                />
                <ExitTile
                  label="מנצח ממוצע"
                  value={`+${exp.avgWinR.toFixed(2)}R`}
                  sub="כמה אתה מוציא כשצדקת"
                  color="#6fa580"
                />
                <ExitTile
                  label="מפסיד ממוצע"
                  value={`${exp.avgLossR.toFixed(2)}R`}
                  sub="כמה אתה משלם כשטעית"
                  color="#c98080"
                />
              </div>
              <p className="mt-5 text-[13.5px] text-white/55 leading-relaxed text-right">
                {expectancyRead}
              </p>
            </div>
          )}
        </NumberedSection>


        <QuestionBand
          n="B" question="האם אני עושה מה שאמרתי שאעשה?" answer={bandAnswers.b} tone={bandAnswers.bTone}
          body="החלק שנמצא במאה אחוז בשליטתך ולא דורש שום דעה על השוק. מכאן מגיע רוב השיפור של סוחר — לא ממציאת יתרון חדש."
        />

        {/* ══════════ PLAN VS EXECUTION ══════════ */}
        <NumberedSection
          index={2} total={12} eyebrow="Plan vs Execution" title="תוכנית מול ביצוע"
          description={
            pve.measured === 0
              ? 'רשום יעד, סטופ ומחיר יציאה כדי שאפשר יהיה להשוות תוכנית לביצוע.'
              : 'מה ביקשת מהעסקה לעומת מה שבאמת לקחת ממנה.'
          }
        >
          {pve.measured === 0 ? (
            <p className="text-sm text-white/30">
              אין עדיין עסקאות שנרשמו בהן גם תוכנית וגם יציאה.
              {pve.assumed > 0 && ` ל-${pve.assumed} עסקאות יש תוצאה בלי מחיר יציאה — הן לא יכולות לענות על זה.`}
            </p>
          ) : (
            <div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#1c1c1e] border border-[#1c1c1e] rounded-[4px] overflow-hidden">
                <ExitTile
                  label="מימוש התוכנית"
                  value={pve.captureRate === null ? '—' : `${Math.round(pve.captureRate * 100)}%`}
                  sub="מהיעד שקבעת, בעסקאות רווחיות"
                  color={pve.captureRate === null ? '#fff' : pve.captureRate < 0.6 ? '#c98080' : pve.captureRate < 0.9 ? '#d4af37' : '#6fa580'}
                />
                <ExitTile
                  label="תכננת"
                  value={`${pve.avgPlannedRR.toFixed(2)}R`}
                  sub="יחס סיכוי-סיכון ממוצע"
                />
                <ExitTile
                  label="לקחת"
                  value={`${pve.avgRealizedR >= 0 ? '+' : ''}${pve.avgRealizedR.toFixed(2)}R`}
                  sub="בפועל, בממוצע"
                  color={pve.avgRealizedR >= 0 ? '#6fa580' : '#c98080'}
                />
                <ExitTile
                  label="שלמות התיעוד"
                  value={`${Math.round(comp.overall * 100)}%`}
                  sub={`${pve.measured} נמדדו · ${pve.assumed} לא`}
                  color={comp.overall < 0.5 ? '#c98080' : comp.overall < 0.8 ? '#d4af37' : '#6fa580'}
                />
              </div>
              <p className="mt-5 text-[13.5px] text-white/55 leading-relaxed text-right">
                <b className="text-white/75">מה המספר הזה כן אומר ומה לא:</b> הוא משווה את מחיר היציאה שרשמת ליעד שקבעת מראש.
                המערכת לא רואה את הגרף ולא יודעת אם המחיר היה מגיע ליעד בהמשך — היא יודעת רק איפה אתה יצאת ביחס למה שתכננת.
                {' '}שלמות התיעוד היא לא ציון על המסחר — היא קובעת אילו שאלות היומן שלך בכלל מסוגל לענות עליהן.
                {comp.exitPrice < 0.8 && ` כרגע רק ${Math.round(comp.exitPrice * 100)}% מהעסקאות הסגורות נושאות מחיר יציאה, ולכן כל מה שקשור ליציאות נשען על חלק מהתמונה.`}
              </p>
            </div>
          )}
        </NumberedSection>

        {/* ══════════ 07 · EXIT MANAGEMENT ══════════ */}
        <NumberedSection
          index={3} total={12} eyebrow="Exit Management" title="ניהול יציאות"
          description={
            exits.sampleSize === 0
              ? 'רשום יציאות (מחיר + חוזים) על עסקאות כדי לנתח איך אתה יוצא מהן.'
              : 'איך אתה באמת יוצא — איפה סגרת ביחס ליעד שקבעת מראש, וכמה אתה מממש בשלבים. הבסיס הוא מחיר היציאה שרשמת, לא מה שהמחיר עשה אחר כך.'
          }
        >
          {exits.sampleSize === 0 ? (
            <p className="text-sm text-white/30">אין עדיין עסקאות עם יציאות רשומות לניתוח.</p>
          ) : (
            <div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#1c1c1e] border border-[#1c1c1e] rounded-[4px] overflow-hidden">
                <ExitTile
                  label="מימוש היעד"
                  value={exits.captureRatio === null ? '—' : `${Math.round(exits.captureRatio * 100)}%`}
                  sub="מהיעד שקבעת, בעסקאות הרווחיות"
                  color={exits.captureRatio === null ? '#fff' : exits.captureRatio < 0.6 ? '#c98080' : exits.captureRatio < 0.9 ? '#d4af37' : '#6fa580'}
                />
                <ExitTile
                  label="נסגרו לפני היעד"
                  value={`${exits.winnersCutShort}/${exits.winnerCount}`}
                  sub="נסגרו מתחת ל-60% מהיעד"
                  color={exits.winnersCutShort > 0 ? '#d4af37' : '#6fa580'}
                />
                <ExitTile
                  label="יציאות בחלקים"
                  value={`${Math.round(exits.partialExitRate * 100)}%`}
                  sub="מהעסקאות נסגרו בכמה שלבים"
                />
                <ExitTile
                  label="R ממוצע"
                  value={`${exits.avgWinnerR >= 0 ? '+' : ''}${exits.avgWinnerR.toFixed(2)}`}
                  sub={`מנצח · מפסיד ${exits.avgLoserR.toFixed(2)}R`}
                  color="#6fa580"
                />
              </div>
              {exits.captureRatio !== null && exits.captureRatio < 0.7 && (
                <p className="mt-5 text-[13.5px] text-white/55 leading-relaxed text-right">
                  אתה ממש בממוצע רק <b style={{ color: '#d4af37' }}>{Math.round(exits.captureRatio * 100)}%</b> מהיעד שתכננת בעסקאות המנצחות — כלומר אתה נוטה לסגור לפני היעד שקבעת לעצמך. המערכת לא יודעת אם המחיר היה מגיע לשם — רק שאתה יצאת קודם.
                </p>
              )}
            </div>
          )}
        </NumberedSection>

        {/* ══════════ TRACKING ARCHIVE ══════════ */}
        <NumberedSection
          index={4} total={12} eyebrow="Tracking" title="מה היה במעקב"
          description="כל חלון מעקב שנסגר ומה הוא הראה — כולל המקרה שבו היעד השתפר ומשהו אחר נחלש בדרך. המקור הוא תמיד מה שאתה מתעד בעצמך."
        >
          <TrackingArchive />
        </NumberedSection>


        <QuestionBand
          n="C" question="האם יש משהו אמיתי בהיסטוריה שלי?" answer={bandAnswers.c} tone={bandAnswers.cTone}
          body="רק ממצאים שהחזיקו אחרי שלקחנו בחשבון כמה צירופים נבדקו. לרוב התשובה תהיה שאין — וזו תשובה טובה, כי היא מונעת ממך לבנות אמונה על מקריות."
        />
        {/* ══════════ 09 · PATTERN DETECTION ══════════ */}
        <NumberedSection
          index={5} total={12} eyebrow="AI · Pattern Detection" title="גילוי דפוסים"
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
                    <div className="flex items-center gap-2">
                      <ConfidenceBadge level={ins.confidenceLevel} />
                      {/* Which way the slice points, and whether it survived the
                          correction. Together these carry what the separate
                          "what works for you" section used to say — a positive
                          delta IS the strength, and it no longer needs its own
                          model call and its own scroll. */}
                      <span className="font-mono text-[10px] font-bold tracking-[0.1em] px-2 py-1 rounded-sm border"
                        style={ins.delta >= 0
                          ? { color: '#6fa580', borderColor: 'rgba(74,124,89,.4)', background: 'rgba(74,124,89,.1)' }
                          : { color: '#c98080', borderColor: 'rgba(139,58,58,.4)', background: 'rgba(139,58,58,.1)' }}>
                        {/* "נק׳ מהבסיס" is the engine's word for it, not a
                            reader's. The number is the gap in percentage
                            points between this group's success rate and the
                            rest of the journal, and saying so is shorter than
                            explaining what a "בסיס" is. */}
                        {ins.delta >= 0 ? '▲' : '▼'} {Math.abs(ins.delta).toFixed(0)} נק׳ אחוז מול שאר היומן
                      </span>
                      {!ins.significant && (
                        <span className="font-mono text-[10px] font-bold tracking-[0.1em] px-2 py-1 rounded-sm border border-[#2a2a2d] text-white/35">
                          עדיין לא מובהק
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2"><span className="font-mono text-sm font-bold text-white">{ins.subject}</span><span style={{ color: '#d4af37', fontSize: 12 }}>◈</span></div>
                  </div>
                  <InsightText text={ins.title + ' ' + ins.evidence} className="text-[15px] font-medium text-[#c0c0c0] leading-relaxed" />
                  {/* The claim, openable. Every number above this line came
                      from these rows, and until it was here the only way to
                      check one was to read the engine's source. */}
                  <PatternEvidence tradeIds={ins.tradeIds ?? []} trades={trades} subject={ins.subject} />
                </Reveal>
              ))}
            </div>
          )}
        </NumberedSection>

        {/* ══════════ 10 · WEEKLY REPORT ══════════ */}
        <NumberedSection
          index={6} total={12} eyebrow="AI · Weekly Review" title="סיכום השבוע"
          description="השבוע הנוכחי משתי זוויות: מה עשו המספרים, ומה עשית אתה. שתי שאלות שונות על אותו שבוע, ולכן שתי לשוניות ולא פסקה אחת."
        >
          <WeeklyTabs hasEnoughData={hasEnoughData} isoWeekKey={isoWeekKey} todayISO={todayISO} fingerprint={fingerprint} />
        </NumberedSection>


        <QuestionBand
          n="D" question="להתמצאות בלבד"
          body="פילוחים, לא ממצאים. הם מראים איפה העסקאות שלך יושבות — לא מה עובד. אף אחד מהם לא נבדק מול מקריות, ולכן פער יפה באחד מהם הוא כיוון למחשבה בלבד, לא סיבה לשנות משהו."
          muted
        />
        {/* ══════════ 01 · INSTRUMENT ══════════ */}
        <NumberedSection
          index={7} total={12} eyebrow="Instrument Edge" title="ניתוח לפי מכשיר"
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

        {/* ══════════ 03 · TIME SIGNATURE ══════════ */}
        <NumberedSection
          index={8} total={12} eyebrow="Time Signature" title="חתימת זמן"
          description="מתי הביצועים בשיאם ומתי הם נחלשים — לפי שעה בסשן וחודש. הפילוח לפי יום בשבוע נמצא בדף הסטטיסטיקה."
        >
          <div>
            <div className="grid gap-9" style={{ gridTemplateColumns: '1fr' }}>
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
                    {hourRows.map(g => <VBar key={g.key} pct={g.pct} tone={g.tone} label={g.label} labelSize={10} />)}
                  </div>
                </div>
              )}
              {hourRows.length === 0 && (
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

        {/* ══════════ 04 · MODEL / SETUP ══════════ */}
        <NumberedSection
          index={9} total={12} eyebrow="Model / Setup" title="מודל / סטאפ"
          description={
            confirmationRows.length === 0 ? 'עדיין לא תיוגת עסקאות במודל/סטאפ ספציפי.'
            : confirmationRows.length === 1 ? `כרגע יש נתונים רק על "${confirmationRows[0].key}".`
            : `לפי תגית המודל/הסטאפ שסימנת בכל עסקה — "${bestConf.key}" נושא את הרווח; "${worstConf.key}" חלש יותר.`
          }
        >
          {confirmationRows.length === 0 ? (
            <p className="text-sm text-white/30">תייג עסקאות עם מודל/סטאפ מהפלייבוק כדי לקבל ניתוח כאן.</p>
          ) : (
            <div>
              {confirmationRows.map(g => (
                <div key={g.key} className="grid gap-6 sm:gap-9 items-center py-[26px] border-b border-[#1c1c1e] last:border-0" style={{ gridTemplateColumns: 'minmax(0,1fr) clamp(200px,24vw,260px)' }}>
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

        {/* ══════════ 05 · CONFIRMATION TAGS ══════════ */}
        <NumberedSection
          index={10} total={12} eyebrow="Confluence Tags" title="אישורי כניסה"
          description={
            confirmationTagRows.length === 0
              ? 'עדיין לא סימנת אישורי כניסה על עסקאות.'
              : 'לפי אישורי הכניסה שסימנת — כל אישור בפני עצמו, ואילו שילובים באמת עובדים ביחד.'
          }
        >
          {confirmationTagRows.length === 0 ? (
            <p className="text-sm text-white/30">סמן אישורי כניסה (SMT, IFVG, CISD...) בטופס העסקה כדי לראות מה באמת עובד.</p>
          ) : (
            <div>
              {confirmationTagRows.map(g => <StatRow key={g.key} label={confLabel(g.key)} ltr g={g} />)}
              {comboRows.filter(c => c.key.includes('+')).length > 0 && (
                <div className="mt-9">
                  <span className="block font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[#d4af37] mb-1">שילובי אישורים</span>
                  <p className="text-[13px] text-white/45 mb-4 leading-relaxed">האם ערימת אישורים באמת משפרת את התוצאה — או שאתה מסבך בלי תמורה.</p>
                  {comboRows.filter(c => c.key.includes('+')).map(g => (
                    <StatRow key={g.key} label={g.key.split('+').map(confLabel).join(' + ')} ltr g={g} />
                  ))}
                </div>
              )}
            </div>
          )}
        </NumberedSection>

        {/* ══════════ 06 · EMOTIONAL STATE ══════════ */}
        <NumberedSection
          index={11} total={12} eyebrow="Psychology" title="מצב רגשי"
          description={
            emotionRows.length === 0
              ? 'עדיין לא תיעדת מצב רגשי לפני כניסה.'
              : 'איך המצב הרגשי שלך לפני הכניסה משתקף בתוצאות — הפער שבין מסחר רגוע למסחר מתוך לחץ או FOMO.'
          }
        >
          {emotionRows.length === 0 ? (
            <p className="text-sm text-white/30">בחר מצב רגשי בטופס העסקה כדי לגלות איך רגש משפיע על הביצועים שלך.</p>
          ) : (
            <div>
              {emotionRows.map(g => <StatRow key={g.key} label={EMOTION_HE[g.key] ?? g.key} g={g} />)}
            </div>
          )}
        </NumberedSection>


        <QuestionBand
          n="E" question="כלי"
          body="לא ניתוח אלא שאלה שאתה שואל: מה היו המספרים אילו סיננת תנאי מסוים."
          muted
        />
        {/* ══════════ 11 · WHAT-IF SIMULATOR ══════════ */}
        <NumberedSection
          index={12} total={12} eyebrow="What-If" title="סימולטור תרחישים"
          description="מה היו הנתונים שלך אילו סיננת תנאי מסוים — רק כשהרגשתי FOMO, רק לונדון, רק NQ, או רק בין 16:00–17:00. הכל מותאם למה שאתה בעצמך תיעדת, וחושב במדויק על העסקאות האמיתיות שלך — לא ניחוש."
        >
          {baseScenarios.length === 0 && !hourCapable ? (
            <p className="text-sm text-white/30">אין עדיין מספיק גיוון בעסקאות כדי להריץ תרחיש. תייג מצב רגשי / אישורים ותעד עסקאות בסשנים, נכסים ושעות שונים.</p>
          ) : (
            <div>
              <div className="flex flex-col gap-4 mb-6">
                {GROUP_ORDER.map(group => {
                  if (group === 'שעה') {
                    if (!hourCapable) return null;
                    const active = hourStartMin != null && whatIfId === `hour_${hourStartMin}`;
                    const endMin = hourStartMin != null ? (hourStartMin + 60) % 1440 : null;
                    const inputCls = `py-2 px-3 rounded-lg border bg-[#0a0a0b] font-mono text-xs font-semibold outline-none transition-colors [color-scheme:dark] ${active ? 'border-[#d4af37]/60 text-[#d4af37]' : 'border-[#222] text-white/70 hover:border-[#2a2a2d]'}`;
                    const pickStart = (v: string) => {
                      if (!v) { setHourStartMin(null); if (whatIfId?.startsWith('hour_')) setWhatIfId(null); return; }
                      const [h, mi] = v.split(':').map(Number); const m = h * 60 + mi;
                      setHourStartMin(m); setWhatIfId(`hour_${m}`);
                    };
                    const pickEnd = (v: string) => {
                      if (!v) { setHourStartMin(null); if (whatIfId?.startsWith('hour_')) setWhatIfId(null); return; }
                      const [h, mi] = v.split(':').map(Number); const m = (h * 60 + mi - 60 + 1440) % 1440;
                      setHourStartMin(m); setWhatIfId(`hour_${m}`);
                    };
                    return (
                      <div key="שעה">
                        <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/30 mb-2">שעה · חלון של שעה, לבחירתך</span>
                        <div className="flex items-center gap-2.5 flex-wrap" dir="ltr">
                          <input type="time" step={60} aria-label="שעת התחלה" value={hourStartMin != null ? fmtMin(hourStartMin) : ''} onChange={e => pickStart(e.target.value)} className={inputCls} />
                          <span className="font-mono text-xs text-white/30">→</span>
                          <input type="time" step={60} aria-label="שעת סיום" value={endMin != null ? fmtMin(endMin) : ''} onChange={e => pickEnd(e.target.value)} className={inputCls} />
                        </div>
                      </div>
                    );
                  }
                  const items = baseScenarios.filter(s => SCENARIO_GROUP[s.kind] === group);
                  if (items.length === 0) return null;
                  return (
                    <div key={group}>
                      <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/30 mb-2">{group}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {items.map(s => (
                          <button
                            key={s.id}
                            onClick={() => setWhatIfId(prev => (prev === s.id ? null : s.id))}
                            className={`py-2 px-3.5 rounded-lg border font-mono text-xs font-semibold transition-all duration-150 ${
                              whatIfId === s.id ? 'border-[#d4af37]/60 bg-[#d4af37]/10 text-[#d4af37]' : 'border-[#222] text-white/45 hover:text-white/75 hover:border-[#2a2a2d]'
                            }`}
                          >
                            {scenarioLabel(s)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {!whatIf ? (
                <p className="text-sm text-white/30">בחר תרחיש למעלה כדי לראות איך זה משנה את המספרים.</p>
              ) : (
                <div>
                  {whatIf.confidence.level === 'low' && (
                    <div className="mb-5 px-4 py-3 rounded-xl border border-[#d4af37]/25 bg-[#d4af37]/[0.05]">
                      <span className="font-mono text-[12px] text-[#d4af37] leading-relaxed">
                        ⚠ נותרו רק {whatIf.keptClosed} עסקאות שנסגרו בתרחיש הזה — מדגם קטן מדי כדי להסיק ממנו מסקנה — זה כיוון ראשוני בלבד.
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#1c1c1e] border border-[#1c1c1e] rounded-[4px] overflow-hidden">
                    {([
                      { label: 'אחוז הצלחה', actual: whatIf.actual.winRate, filtered: whatIf.filtered.winRate, suffix: '%', dec: 0 },
                      { label: 'רווח/הפסד', actual: whatIf.actual.totalPnl, filtered: whatIf.filtered.totalPnl, money: true, dec: 0 },
                      { label: 'פרופיט פקטור', actual: whatIf.actual.profitFactor, filtered: whatIf.filtered.profitFactor, dec: 2 },
                      { label: 'R:R ממוצע', actual: whatIf.actual.avgRR, filtered: whatIf.filtered.avgRR, dec: 2 },
                    ] as { label: string; actual: number; filtered: number; suffix?: string; money?: boolean; dec: number }[]).map(m => {
                      const delta = m.filtered - m.actual;
                      const better = delta >= 0;
                      const fmt = (v: number) => !Number.isFinite(v) ? '∞' : m.money ? `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(0)}` : `${v.toFixed(m.dec)}${m.suffix ?? ''}`;
                      return (
                        <div key={m.label} className="bg-[#0a0a0b] px-5 py-6">
                          <span className="block font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-white/45 mb-3">{m.label}</span>
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="num font-mono text-white/35 text-sm line-through">{fmt(m.actual)}</span>
                            <span className="num font-mono font-extrabold" style={{ fontSize: 'clamp(22px,2.2vw,30px)', color: better ? '#6fa580' : '#c98080' }}>{fmt(m.filtered)}</span>
                          </div>
                          {Number.isFinite(delta) && Math.abs(delta) > 0.001 && (
                            <span className="block font-mono text-[11px] font-bold mt-2" style={{ color: better ? '#6fa580' : '#c98080' }}>
                              {better ? '▲' : '▼'} {m.money ? `$${Math.abs(delta).toFixed(0)}` : `${Math.abs(delta).toFixed(m.dec)}${m.suffix ?? ''}`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-4 font-mono text-[12px] text-white/45 leading-relaxed text-right">
                    התרחיש שומר {whatIf.keptTrades} עסקאות ({whatIf.keptClosed} שנסגרו) ומסיר {whatIf.removedTrades}. ההשוואה היא מול כלל היומן שלך.
                  </p>
                </div>
              )}
            </div>
          )}
        </NumberedSection>

      </div>
    </div>
  );
}
