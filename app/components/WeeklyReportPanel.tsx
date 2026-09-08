'use client';

// Weekly AI Report — the standalone card that fetches, renders, and archives
// the trader's weekly narrative. Extracted from the inline block in
// /dashboard/ai-analytics so it can carry its own typography without
// competing with the numbered-section rhythm around it.
//
// Two data sources:
//   • Current week — POST /api/ai/weekly-report, cached per ISO week in
//     localStorage so the analytics page doesn't re-fire an LLM call every
//     time the trader hits the tab.
//   • History — GET /api/ai/weekly-report/history, backed by the
//     weekly_ai_reports table. Persistent, cross-device, not localStorage.

import { usePortfolios } from './PortfolioProvider';
import { useEffect, useState, useMemo } from 'react';
import InsightText from './InsightText';
import TypingDots from './TypingDots';
import { readInsightCache, writeInsightCache } from '../lib/ai/insightCache';
import { MIN_TRADES_FOR_WEEKLY_CLAIMS } from '../lib/intelligence/weeklyRules';

type ConfidenceLevel = 'low' | 'medium' | 'high';
interface WeeklyReport { paragraphs: string[]; confidenceLevel: ConfidenceLevel; sampleSize: number; aiWritten?: boolean; }
interface HistoryEntry {
  isoWeek: string;
  weekStartDate: string;    // 'YYYY-MM-DD'
  tradeCount: number;
  confidenceLevel: string;
  paragraphs: string[];
}

const M_HEB = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** "23-29 ביולי" — date range for a week starting on the given Monday date.
    Handles month rollovers ("28 ביולי - 3 באוגוסט"). */
function formatWeekRange(startISO: string): string {
  const [y, m, d] = startISO.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}-${end.getDate()} ב${M_HEB[start.getMonth()]}`;
  }
  return `${start.getDate()} ב${M_HEB[start.getMonth()]} - ${end.getDate()} ב${M_HEB[end.getMonth()]}`;
}

const CONF_LABEL: Record<string, string> = { high: 'ביטחון גבוה', medium: 'ביטחון בינוני', low: 'ביטחון נמוך' };
const CONF_STYLE: Record<string, { color: string; bg: string; bd: string }> = {
  high:   { color: '#5fd39e', bg: 'rgba(95,211,158,0.10)',  bd: 'rgba(95,211,158,0.35)' },
  medium: { color: '#e6c665', bg: 'rgba(230,198,101,0.10)', bd: 'rgba(230,198,101,0.35)' },
  low:    { color: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.03)', bd: 'rgba(255,255,255,0.10)' },
};

function ConfChip({ level, size = 'md' }: { level: string; size?: 'sm' | 'md' }) {
  const s = CONF_STYLE[level] ?? CONF_STYLE.low;
  const cls = size === 'sm' ? 'py-1 px-2.5 text-[11px]' : 'py-1.5 px-3 text-[12px]';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-bold border ${cls}`} style={{ color: s.color, background: s.bg, borderColor: s.bd }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
      {CONF_LABEL[level] ?? level}
    </span>
  );
}

/** A week below the claim floor is written from counts alone — no comparison,
 *  no cause, no conclusion. Labelling that "low confidence" would be wrong in
 *  both directions: there is no claim to be unconfident about, and the chip
 *  reads as a weak verdict rather than as a record. */
function isFactual(tradeCount: number): boolean {
  return tradeCount < MIN_TRADES_FOR_WEEKLY_CLAIMS;
}

function KindChip({ tradeCount, level, size = 'md' }: { tradeCount: number; level: string; size?: 'sm' | 'md' }) {
  if (!isFactual(tradeCount)) return <ConfChip level={level} size={size} />;
  const cls = size === 'sm' ? 'py-1 px-2.5 text-[11px]' : 'py-1.5 px-3 text-[12px]';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-bold border ${cls}`}
      style={{ color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.12)' }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.5)' }} />
      תיעוד השבוע
    </span>
  );
}

/** "4 עסקאות" / "עסקה אחת" / "בלי עסקאות סגורות". Zero is a real state now
 *  that quiet weeks are written, and "0 עסקאות" reads like a broken counter. */
function tradeCountLabel(n: number): string {
  if (n === 0) return 'בלי עסקאות סגורות';
  if (n === 1) return 'עסקה אחת';
  return `${n} עסקאות`;
}

/* ── Panel ────────────────────────────────────────────────────────────── */

export default function WeeklyReportPanel({
  isoWeekKey, todayISO, fingerprint,
}: {
  isoWeekKey: (dateISO: string) => string;
  todayISO: () => string;
  /** Identifies the trades this week's narrative was written about. A report
   *  cached under a different one describes a journal that has since changed,
   *  so it is a miss, not content. */
  fingerprint: string;
}) {
  // The AI answers about the portfolio on screen. Sent with every request and
  // re-fetched when it changes — a cached answer about the other account is
  // the same failure as a mixed win rate, with a delay on it.
  const { selected } = usePortfolios();
  const account = selected?.id ?? null;
  const [report, setReport]       = useState<WeeklyReport | null>(null);
  const [loading, setLoading]     = useState(false);
  const [history, setHistory]     = useState<HistoryEntry[]>([]);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);

  const thisWeek = useMemo(() => isoWeekKey(todayISO()), [isoWeekKey, todayISO]);

  // Fetch current week's report (with a per-week localStorage cache so we
  // don't re-fire the LLM on every page visit).
  useEffect(() => {
    // No trade-count gate here any more. The report is written for every week,
    // including a week with four trades and a week with none — the server
    // decides what the report may CLAIM, not whether it exists. Gating the
    // fetch on a count was the second half of the same bug.
    // The portfolio is part of the key. Without it the cache would serve one
    // account's weekly report while the other is on screen.
    const cachePrefix = `onyx_ai_weekly_report_v3_${account ?? 'none'}_`;
    const cacheKey = cachePrefix + thisWeek;
    const cached = readInsightCache<WeeklyReport>(cacheKey, fingerprint);
    if (cached && Array.isArray(cached.value?.paragraphs)) { setReport(cached.value); return; }
    setLoading(true);
    fetch('/api/ai/weekly-report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: 'he', account }),
    })
      .then(r => r.json())
      .then(({ report }: { report: WeeklyReport | null }) => {
        if (!report || !Array.isArray(report.paragraphs) || report.paragraphs.length === 0) return;
        setReport(report);
        writeInsightCache(cacheKey, cachePrefix, fingerprint, report, new Date().toISOString());
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [thisWeek, fingerprint, account]);

  // Fetch the archive from the DB (persistent, cross-device — replaces the
  // old localStorage-only snippet strip).
  useEffect(() => {
    fetch(`/api/ai/weekly-report/history${account ? `?account=${encodeURIComponent(account)}` : ''}`)
      .then(r => r.json())
      .then(({ reports }: { reports: HistoryEntry[] }) => {
        if (Array.isArray(reports)) setHistory(reports);
      })
      .catch(() => {});
  }, [report, account]); // Re-fetch after a new current-week report lands so the
                // new one shows up in history without a page reload.

  // Past-weeks entries only — filter out the current week (rendered above).
  const past = history.filter(h => h.isoWeek !== thisWeek);

  const toggleExpand = (weekKey: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(weekKey)) next.delete(weekKey); else next.add(weekKey);
    return next;
  });

  return (
    <div dir="rtl" className="flex flex-col gap-6">
      <CurrentReport loading={loading} report={report} thisWeek={thisWeek} />
      {past.length > 0 && (
        <HistorySection
          entries={past}
          shown={showHistory}
          onToggle={() => setShowHistory(v => !v)}
          expanded={expanded}
          onExpand={toggleExpand}
        />
      )}
      <p className="mt-2 font-mono text-[12px] font-semibold text-white/35 leading-relaxed text-right max-w-[720px] ms-auto">
        אנליטיקת ה-AI היא נקודת מבט נוספת של המערכת על היומן שלך — תמיד מומלץ להפעיל שיקול דעת עצמאי. המסחר כרוך בסיכון משמעותי.
      </p>
    </div>
  );
}

/* ── Current-week card ────────────────────────────────────────────────── */

function CurrentReport({
  loading, report, thisWeek,
}: {
  loading: boolean;
  report: WeeklyReport | null;
  thisWeek: string;
}) {
  if (loading) {
    return (
      <div className="rounded-[16px] border border-[#1c1c1e] bg-[#0a0a0b] p-8">
        <div className="flex items-center gap-3 py-4"><TypingDots /><span className="text-[15px] text-white/50">מכין את הדוח השבועי...</span></div>
      </div>
    );
  }
  if (!report) {
    // A report now exists for every week — including a week with four trades
    // and a week with none. So an absent report is no longer a statement
    // about the trader's week; it means the request did not come back. Say
    // that, and nothing else: the old copy here explained a threshold, which
    // would now be explaining a rule that no longer exists.
    return (
      <div
        className="rounded-[16px] border p-8 sm:p-10 text-center flex flex-col items-center gap-3"
        style={{ background: 'linear-gradient(180deg, #0b0b0d 0%, #050506 100%)', borderColor: '#1c1c1e' }}
      >
        <div className="font-mono text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: 'rgba(212,175,55,0.6)' }}>
          הדוח לא נטען
        </div>
        <h3 style={{ fontFamily: 'var(--serif)' }} className="m-0 text-[26px] max-[880px]:text-[21px] font-bold text-white leading-tight">
          לא הצלחתי להביא את הדוח השבועי
        </h3>
        <p className="m-0 text-[15px] leading-relaxed text-white/60" style={{ maxWidth: '54ch' }}>
          זו תקלה בטעינה ולא משהו שחסר ביומן שלך. הדוח נכתב על כל שבוע, גם שבוע עם מעט עסקאות וגם שבוע בלי אף אחת. נסה לרענן את העמוד.
        </p>
      </div>
    );
  }

  const focus = report.paragraphs[report.paragraphs.length - 1] ?? '';
  const body = report.paragraphs.slice(0, -1);

  return (
    <article
      className="rounded-[16px] border p-8 sm:p-10 max-[880px]:p-5 flex flex-col gap-6"
      style={{
        background: 'linear-gradient(180deg, #0b0b0d 0%, #050506 100%)',
        borderColor: 'rgba(212,175,55,0.18)',
        boxShadow: '0 40px 90px -40px rgba(0,0,0,0.9), 0 0 60px -30px rgba(212,175,55,0.15)',
      }}
    >
      {/* Header block — eyebrow + week + confidence */}
      <header className="flex items-start justify-between gap-4 pb-6 border-b border-[#1c1c1e] flex-wrap">
        <div>
          {/* A factual week is a record of counts. It may also carry an AI
              observation placing those trades against the whole journal — or
              may not, if the model was unreachable. Saying "AI" over a report
              no model touched would be the one false claim in a report built
              to avoid them, so the flag travels with the report rather than
              being guessed from the trade count. */}
          <div className="font-mono text-[12px] font-bold tracking-[0.28em] uppercase text-[#d4af37] mb-2.5">
            {!isFactual(report.sampleSize) ? 'AI · WEEKLY REPORT'
              : report.aiWritten ? 'WEEKLY RECORD · AI NOTE'
              : 'WEEKLY RECORD'}
          </div>
          <h2 style={{ fontFamily: 'var(--serif)' }} className="text-[34px] max-[880px]:text-[26px] font-bold text-white leading-[1.05] m-0 tracking-[-0.005em]">
            הדוח השבועי שלך
          </h2>
          <div className="mt-2 font-mono text-[13px] text-white/55 tabular-nums">
            <span dir="ltr">{thisWeek}</span> · {tradeCountLabel(report.sampleSize)}
          </div>
        </div>
        <div className="shrink-0">
          <KindChip tradeCount={report.sampleSize} level={report.confidenceLevel} />
        </div>
      </header>

      {/* Body paragraphs — magazine typography */}
      {body.length > 0 && (
        <div className="flex flex-col gap-5">
          {body.map((p, i) => (
            <p
              key={i}
              className="text-[18px] max-[880px]:text-[16px] leading-[1.75] text-white/85 m-0"
              style={{ fontFamily: 'var(--serif)' }}
            >
              <InsightText text={p} className="" />
            </p>
          ))}
        </div>
      )}

      {/* Focus for next week — the takeaway callout */}
      {focus && (
        <aside
          className="mt-2 rounded-[12px] p-5 sm:p-6"
          style={{
            border: '1px solid rgba(212,175,55,0.35)',
            background: 'radial-gradient(120% 140% at 100% 0%, rgba(212,175,55,0.08), transparent 60%), rgba(212,175,55,0.03)',
            boxShadow: '0 0 40px -20px rgba(212,175,55,0.35)',
          }}
        >
          <div className="flex items-center gap-2.5 mb-3">
            <span className="text-[15px] text-[#d4af37]">◈</span>
            <span className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-[#d4af37]">המיקוד לשבוע הבא</span>
          </div>
          <p className="text-[17px] max-[880px]:text-[15px] leading-[1.65] font-semibold text-white m-0" style={{ fontFamily: 'var(--serif)' }}>
            <InsightText text={focus} className="" />
          </p>
        </aside>
      )}
    </article>
  );
}

/* ── History archive ──────────────────────────────────────────────────── */

function HistorySection({
  entries, shown, onToggle, expanded, onExpand,
}: {
  entries: HistoryEntry[];
  shown: boolean;
  onToggle: () => void;
  expanded: Set<string>;
  onExpand: (weekKey: string) => void;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 py-4 px-5 rounded-[12px] border border-[#1c1c1e] bg-white/[0.02] hover:border-[#d4af37]/25 transition-colors"
      >
        <span className="flex items-center gap-3">
          <span className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-[#d4af37]">ארכיון · {entries.length} דוחות</span>
          <span className="text-[13px] text-white/55">חזור לשבועות קודמים והשווה איך הסיפור התפתח</span>
        </span>
        <span className="text-white/45 text-lg" aria-hidden>{shown ? '−' : '+'}</span>
      </button>
      {shown && (
        <div className="mt-4 flex flex-col gap-3">
          {entries.map(h => (
            <HistoryCard
              key={h.isoWeek}
              entry={h}
              expanded={expanded.has(h.isoWeek)}
              onToggle={() => onExpand(h.isoWeek)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryCard({
  entry, expanded, onToggle,
}: { entry: HistoryEntry; expanded: boolean; onToggle: () => void }) {
  const headline  = entry.paragraphs[0] ?? '';
  const focusLine = entry.paragraphs.length > 1 ? entry.paragraphs[entry.paragraphs.length - 1] : '';
  const body      = expanded ? entry.paragraphs.slice(0, -1) : [];

  return (
    <div
      className="rounded-[12px] border border-[#1c1c1e] bg-[#0a0a0b] transition-all"
      style={{ borderColor: expanded ? 'rgba(212,175,55,0.28)' : undefined }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-right p-5 flex items-start justify-between gap-4"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <span className="font-mono text-[12px] font-bold tracking-[0.14em] uppercase text-[#d4af37]" dir="ltr">{entry.isoWeek}</span>
            <span className="text-[13px] font-semibold text-white/85">{formatWeekRange(entry.weekStartDate)}</span>
            <span className="text-[12px] text-white/40 font-mono tabular-nums">· {tradeCountLabel(entry.tradeCount)}</span>
            <KindChip tradeCount={entry.tradeCount} level={entry.confidenceLevel} size="sm" />
          </div>
          {!expanded && headline && (
            <p className="text-[14px] text-white/70 leading-relaxed line-clamp-2 m-0" style={{ fontFamily: 'var(--serif)' }}>
              <InsightText text={headline} className="" />
            </p>
          )}
        </div>
        <span className="shrink-0 mt-1 text-white/40 text-base" aria-hidden>{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div className="px-5 pb-5 pt-1 flex flex-col gap-4 border-t border-[#1c1c1e]">
          {body.map((p, i) => (
            <p key={i} className="text-[15px] leading-[1.7] text-white/80 m-0" style={{ fontFamily: 'var(--serif)' }}>
              <InsightText text={p} className="" />
            </p>
          ))}
          {focusLine && (
            <div className="mt-1 rounded-[8px] py-3 px-4 border border-[#d4af37]/25 bg-[#d4af37]/[0.04]">
              <div className="font-mono text-[10px] font-bold tracking-[0.14em] uppercase text-[#d4af37] mb-1.5">המיקוד שלך אז</div>
              <p className="text-[14px] font-semibold text-white/90 m-0" style={{ fontFamily: 'var(--serif)' }}>
                <InsightText text={focusLine} className="" />
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
