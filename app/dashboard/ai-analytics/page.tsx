'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadTrades, todayISO } from '../../lib/journal';
import type { TradeEntry } from '../../lib/journal';
import { runFullAnalysis, isoWeekKey } from '../../lib/analytics';
import type { ConfidenceLevel, GroupPerformance } from '../../lib/analytics';
import { SESS } from '../../lib/sessions';
import EmptyState from '../../components/EmptyState';
import InsightText from '../../components/InsightText';
import TypingDots from '../../components/TypingDots';

/** Mirror app/lib/ai/patternInsights.ts and weeklyReport.ts's return shapes
    as local types (not imported) so this client component never pulls in
    the server-only Gemini SDK module. */
interface PatternInsight { title: string; evidence: string; confidenceLevel: ConfidenceLevel; sampleSize: number; }
interface WeeklyReport {
  biggestStrength: string;
  biggestWeakness: string;
  largestImprovement: string;
  largestDecline: string;
  focusNextWeek: string;
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
}

/** Infinity (all wins, zero losses) can't render as a number — the same rule
    the AI facts layer uses, duplicated here since that module is import-only
    from server routes. */
function fmtPF(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '∞';
}

const SESSION_HE: Record<string, string> = Object.fromEntries(SESS.map(s => [s.key, s.he]));

const CONF_LABEL: Record<ConfidenceLevel, string> = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
const CONF_META: Record<ConfidenceLevel, { fg: string; bg: string; bd: string }> = {
  high:   { fg: '#6fa580', bg: 'rgba(111,165,128,.1)',  bd: 'rgba(111,165,128,.32)' },
  medium: { fg: '#d4af37', bg: 'rgba(212,175,55,.08)',  bd: 'rgba(212,175,55,.25)' },
  low:    { fg: '#c0c0c0', bg: 'rgba(255,255,255,.04)', bd: 'rgba(255,255,255,.08)' },
};

function ConfidenceBadge({ level, sampleSize }: { level: ConfidenceLevel; sampleSize: number }) {
  const m = CONF_META[level];
  return (
    <span
      className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] px-2 py-0.5 rounded-sm shrink-0"
      style={{ color: m.fg, background: m.bg, border: `1px solid ${m.bd}` }}
    >
      ביטחון {CONF_LABEL[level]} · n={sampleSize}
    </span>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-serif text-lg text-white">{title}</h2>
        {subtitle && <p className="font-mono text-[10px] text-white/30 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl bg-[#0a0a0b] border border-white/5 p-4">
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/30 mb-1.5">{label}</p>
      <p className="font-serif text-xl" style={{ color: color ?? '#fff' }}>{value}</p>
    </div>
  );
}

function GroupTable({ groups, nameHeader, nameOf, highlightBest, highlightWorst }: {
  groups: GroupPerformance[];
  nameHeader: string;
  nameOf?: (g: GroupPerformance) => string;
  highlightBest?: boolean;
  highlightWorst?: boolean;
}) {
  if (groups.length === 0) {
    return <p className="font-mono text-xs text-white/30">אין עדיין מספיק נתונים לניתוח הזה.</p>;
  }
  const byWinRate = [...groups].sort((a, b) => b.winRate - a.winRate);
  const bestKey = byWinRate[0]?.key;
  const worstKey = byWinRate[byWinRate.length - 1]?.key;

  return (
    <div className="rounded-xl bg-[#0a0a0b] border border-white/5 overflow-hidden overflow-x-auto">
      <table className="w-full min-w-[520px]">
        <thead>
          <tr className="border-b border-white/5">
            {[nameHeader, 'עסקאות', 'הצלחה', 'RR ממוצע', 'פרופיט פקטור', 'רווח/הפסד'].map(h => (
              <th key={h} className="px-4 py-2 text-right font-mono text-[9px] text-white/30 uppercase tracking-[0.12em]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g.key} className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.015] transition-colors">
              <td className="px-4 py-2.5 font-mono text-sm text-white/85 flex items-center gap-2">
                {nameOf ? nameOf(g) : g.label}
                {highlightBest && g.key === bestKey && groups.length > 1 && (
                  <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/25">מיטבי</span>
                )}
                {highlightWorst && g.key === worstKey && groups.length > 1 && (
                  <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/25">חלש ביותר</span>
                )}
              </td>
              <td className="px-4 py-2.5 font-mono text-sm text-white/60">{g.trades}</td>
              <td className="px-4 py-2.5 font-mono text-sm text-white/85">{g.winRate.toFixed(0)}%</td>
              <td className="px-4 py-2.5 font-mono text-sm text-white/60">{g.avgRR.toFixed(2)}</td>
              <td className="px-4 py-2.5 font-mono text-sm text-white/60">{fmtPF(g.profitFactor)}</td>
              <td className={`px-4 py-2.5 font-mono text-sm font-bold ${g.totalPnl >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                {g.totalPnl >= 0 ? '+' : '-'}${Math.abs(g.totalPnl).toFixed(0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AiAnalyticsPage() {
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [patternInsights, setPatternInsights] = useState<PatternInsight[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReport | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [reportHistory, setReportHistory] = useState<{ weekKey: string; report: WeeklyReport }[]>([]);

  useEffect(() => { setTrades(loadTrades()); }, []);

  const analysis = useMemo(() => runFullAnalysis(trades), [trades]);
  const hasEnoughData = trades.filter(t => t.result !== 'OPEN').length >= 3;

  // ── Module 7: pattern insights (AI-phrased, cached per day) ──
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

  // ── Module 8: weekly AI report (cached per ISO week) + Module 9 history ──
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

  return (
    <div className="flex-1 overflow-y-auto" dir="rtl">
      <div className="px-8 max-[880px]:px-4 py-8 pb-24 max-w-5xl mx-auto space-y-10">

        {/* Header */}
        <div>
          <h1 className="font-serif text-3xl text-white">אנליטיקת AI</h1>
          <p className="font-mono text-xs text-white/30 mt-1">מרכז המודיעין של Onyx — הדפוסים שהיומן שלך מסתיר ממך</p>
        </div>

        {/* Module 1 — Performance Overview */}
        <Section title="סקירת ביצועים">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="אחוז הצלחה" value={`${p.winRate.toFixed(1)}%`} color="#d4af37" />
            <StatCard label="רווח/הפסד כולל" value={`${p.totalPnl >= 0 ? '+' : '-'}$${Math.abs(p.totalPnl).toFixed(0)}`} color={p.totalPnl >= 0 ? '#22c55e' : '#ef4444'} />
            <StatCard label="RR ממוצע" value={p.avgRR.toFixed(2)} />
            <StatCard label="פרופיט פקטור" value={fmtPF(p.profitFactor)} />
            <StatCard label="רווח ממוצע" value={`$${p.avgWinner.toFixed(0)}`} color="#22c55e" />
            <StatCard label="הפסד ממוצע" value={`$${p.avgLoser.toFixed(0)}`} color="#ef4444" />
            <StatCard label="סה״כ עסקאות" value={String(p.totalTrades)} />
            <StatCard label="עסקאות סגורות" value={String(p.closedTrades)} />
          </div>
        </Section>

        {/* Module 2 — Instrument Analysis */}
        <Section title="ניתוח לפי מכשיר" subtitle="MNQ · NQ · MES · ES">
          <GroupTable groups={analysis.instruments} nameHeader="מכשיר" highlightBest highlightWorst />
        </Section>

        {/* Module 3 — Session Analysis */}
        <Section title="ניתוח לפי סשן">
          <GroupTable groups={analysis.sessions} nameHeader="סשן" nameOf={g => SESSION_HE[g.key] ?? g.label} highlightBest highlightWorst />
        </Section>

        {/* Module 4 — Time Analysis */}
        <Section title="ניתוח זמן">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {analysis.time.bestHour && <StatCard label="השעה החזקה ביותר" value={analysis.time.bestHour.label} color="#22c55e" />}
            {analysis.time.worstHour && <StatCard label="השעה החלשה ביותר" value={analysis.time.worstHour.label} color="#ef4444" />}
            {analysis.time.bestWeekday && <StatCard label="היום החזק בשבוע" value={analysis.time.bestWeekday.label} color="#22c55e" />}
            {analysis.time.worstWeekday && <StatCard label="היום החלש בשבוע" value={analysis.time.worstWeekday.label} color="#ef4444" />}
            {analysis.time.bestMonth && <StatCard label="החודש החזק ביותר" value={analysis.time.bestMonth.label} color="#d4af37" />}
          </div>
        </Section>

        {/* Module 5 — Direction Analysis */}
        <Section title="לונג מול שורט">
          <GroupTable groups={[analysis.direction.long, analysis.direction.short]} nameHeader="כיוון" nameOf={g => g.key === 'LONG' ? 'לונג' : 'שורט'} />
        </Section>

        {/* Module 6 — Confirmation Analysis */}
        <Section title="ניתוח אישורים" subtitle="לפי תגית המודל/הסטאפ שסימנת לכל עסקה">
          <GroupTable groups={analysis.confirmations} nameHeader="אישור" highlightBest highlightWorst />
        </Section>

        {/* Module 7 — Pattern Discovery */}
        <Section title="גילוי דפוסים" subtitle="הצירופים המובהקים ביותר בנתונים שלך">
          {patternsLoading ? (
            <div className="flex items-center gap-2 py-4"><TypingDots /><span className="font-mono text-xs text-white/30">מאתר דפוסים...</span></div>
          ) : patternInsights.length === 0 ? (
            <p className="font-mono text-xs text-white/30">אין עדיין מספיק נתונים היסטוריים כדי לגלות דפוס מובהק.</p>
          ) : (
            <div className="grid gap-3">
              {patternInsights.map((ins, i) => (
                <div key={i} className="rounded-xl bg-[#0a0a0b] border border-white/5 p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <InsightText text={ins.title} className="font-mono text-sm text-white/90 leading-relaxed" />
                    <ConfidenceBadge level={ins.confidenceLevel} sampleSize={ins.sampleSize} />
                  </div>
                  <InsightText text={ins.evidence} className="font-mono text-xs text-white/40 leading-relaxed" />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Module 8 — Weekly AI Report */}
        <Section title="דוח שבועי" subtitle="השבוע האחרון (7 ימים)">
          {weeklyLoading ? (
            <div className="flex items-center gap-2 py-4"><TypingDots /><span className="font-mono text-xs text-white/30">מכין את הדוח השבועי...</span></div>
          ) : !weeklyReport ? (
            <p className="font-mono text-xs text-white/30">אין עדיין מספיק נתונים היסטוריים כדי לייצר תובנה ברמת ביטחון גבוהה.</p>
          ) : (
            <div className="rounded-xl bg-[#0a0a0b] border border-white/5 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/30">דוח AI שבועי</span>
                <ConfidenceBadge level={weeklyReport.confidenceLevel} sampleSize={weeklyReport.sampleSize} />
              </div>
              {[
                { k: 'החוזק הגדול ביותר', v: weeklyReport.biggestStrength, c: '#22c55e' },
                { k: 'החולשה הגדולה ביותר', v: weeklyReport.biggestWeakness, c: '#ef4444' },
                { k: 'השיפור הגדול ביותר', v: weeklyReport.largestImprovement, c: '#6fa580' },
                { k: 'הירידה הגדולה ביותר', v: weeklyReport.largestDecline, c: '#c98080' },
                { k: 'המיקוד לשבוע הבא', v: weeklyReport.focusNextWeek, c: '#d4af37' },
              ].map(row => (
                <div key={row.k}>
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] mb-1" style={{ color: row.c }}>{row.k}</p>
                  <InsightText text={row.v} className="font-mono text-sm text-white/80 leading-relaxed" />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Module 9 — Historical Discoveries */}
        <Section title="גילויים קודמים" subtitle="ארכיון הדוחות השבועיים">
          {reportHistory.length === 0 ? (
            <p className="font-mono text-xs text-white/30">אין עדיין דוחות קודמים.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {reportHistory.map(h => (
                <div key={h.weekKey} className="rounded-lg bg-[#0a0a0b] border border-white/5 p-3 flex items-start gap-3">
                  <span className="font-mono text-[9px] text-white/30 shrink-0 mt-0.5" dir="ltr">{h.weekKey}</span>
                  <InsightText text={h.report.biggestStrength} className="font-mono text-xs text-white/60 leading-relaxed" />
                </div>
              ))}
            </div>
          )}
        </Section>

        <p className="font-mono text-[10px] text-white/20 text-center pt-4">
          כל התובנות מבוססות על היומן האישי שלך בלבד ואינן מהוות ייעוץ או המלצת מסחר.
        </p>
      </div>
    </div>
  );
}
