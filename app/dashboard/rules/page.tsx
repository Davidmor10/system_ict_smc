'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../hooks/useLanguage';
import { loadTrades, todayISO } from '../../lib/journal';
import type { TradeEntry } from '../../lib/journal';
import { hydrateList, commitList } from '../../lib/sync/collections';
import ConfirmDialog from '../../components/ConfirmDialog';
import { sessionLabel, activeSessions } from '../../lib/sessions';
import { INSTRUMENT_KEYS } from '../../lib/instruments';
import { AUTO_SUPPORTED } from '../../lib/rules/engine';
import { computeRulePerformance, type RulePerformance } from '../../lib/rules/performance';
import { computeRuleStats, computeRuleHistory, type RuleStatsResult, type RuleHistory } from '../../lib/rules/stats';
import { ruleImpact, ruleConfidence, confidenceLabel, ruleInsight, dashboardRuleInsights } from '../../lib/rules/insight';
import {
  ruleTitle, ruleVerification, ruleSeverity, upsertCheck,
  type Rule, type RuleCheck, type RuleCategory, type ConditionType, type ConditionValue, type RuleScope, type RuleSeverity, type VerificationMode,
} from '../../lib/rules/types';

const STORAGE_KEY = 'onyx_trading_rules';
const VIOLATIONS_KEY = 'onyx_rule_violations';
const CHECKS_KEY = 'onyx_rule_checks';

/** Legacy day-level violation (kept so the What-If simulator keeps reading the
    same shape it always has). */
interface Violation { id: string; ruleId: string; date: string; tradeNote?: string; updatedAt?: number; deleted?: boolean; }

function ensureVioIds(list: unknown): Violation[] {
  if (!Array.isArray(list)) return [];
  return list.map((v, i) => (v?.id ? v : { ...v, id: `${v?.ruleId ?? 'v'}-${v?.date ?? ''}-${i}-${Math.random().toString(36).slice(2, 8)}` })) as Violation[];
}

// ── Palette (mirrors globals.css — no new colors) ────────────────────────────
const GOLD = '#d4af37';
const SURFACE = '#0d0d0f';
const RAISED = '#1c1c1e';
const BORDER = '#1c1c1e';
const BORDER_STRONG = '#2a2a2d';
const TONE: Record<string, string> = { white: '#fff', gold: GOLD, long: '#6fa580', short: '#c98080', muted: 'rgba(255,255,255,0.55)' };
const WASH_GOLD = 'radial-gradient(60% 60% at 50% 40%, rgba(212,175,55,0.07), transparent 60%)';

const CAT_META: { key: RuleCategory; he: string; en: string; color: string }[] = [
  { key: 'discipline', he: 'משמעת', en: 'Discipline', color: GOLD },
  { key: 'entry', he: 'כניסה', en: 'Entry', color: '#3b82f6' },
  { key: 'trade_mgmt', he: 'ניהול עסקה', en: 'Trade Mgmt', color: '#22c55e' },
  { key: 'risk', he: 'ניהול סיכון', en: 'Risk', color: '#ef4444' },
  { key: 'time', he: 'זמן', en: 'Time', color: '#a855f7' },
  { key: 'news', he: 'חדשות', en: 'News', color: '#f59e0b' },
];
const LEGACY_CAT_HE: Record<string, string> = { exit: 'ניהול עסקה' };
const catLabel = (c: string) => CAT_META.find(x => x.key === c)?.he ?? LEGACY_CAT_HE[c] ?? c;

/** Severity colours match the design system exactly: steel / gold / burgundy. */
const SEVERITY_META: { key: RuleSeverity; he: string; color: string }[] = [
  { key: 'recommendation', he: 'המלצה', color: '#7a8fa8' },
  { key: 'important', he: 'חשוב', color: GOLD },
  { key: 'critical', he: 'קריטי', color: '#8b3a3a' },
];
const sevMeta = (s: RuleSeverity) => SEVERITY_META.find(m => m.key === s) ?? SEVERITY_META[1];

const VERIFY_META: { key: VerificationMode; he: string }[] = [
  { key: 'automatic', he: 'אוטומטית' },
  { key: 'user_report', he: 'דיווח משתמש' },
];

const CONDITION_META: { key: ConditionType; he: string }[] = [
  { key: 'max_trades_per_day', he: 'מקסימום עסקאות ביום' },
  { key: 'max_risk_per_trade', he: 'מקסימום סיכון לעסקה' },
  { key: 'max_daily_loss', he: 'מקסימום הפסד יומי' },
  { key: 'stop_after_losses', he: 'עצירה אחרי מספר הפסדים' },
  { key: 'allowed_hours', he: 'שעות מסחר מותרות' },
  { key: 'allowed_sessions', he: 'סשנים מותרים' },
  { key: 'allowed_symbols', he: 'נכסים מותרים' },
  { key: 'no_trade_around_news', he: 'איסור מסחר סביב חדשות' },
  { key: 'required_confirmations', he: 'אישורים נדרשים לכניסה' },
];

const SCOPE_META: { key: RuleScope; he: string }[] = [
  { key: 'always', he: 'תמיד' },
  { key: 'per_symbol', he: 'לפי נכס' },
  { key: 'per_session', he: 'לפי סשן' },
  { key: 'per_day', he: 'לפי יום' },
  { key: 'per_hour', he: 'לפי שעה' },
  { key: 'around_news', he: 'סביב חדשות' },
];

const CONFIRMATION_TAGS = ['SMT', 'IFVG', 'CISD', 'ORDER_BLOCK'];
const M_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const M_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "16 ביולי 2026" / "July 16, 2026" — built straight from the ISO parts (no
    Date() round-trip), so it can never drift a day from `todayISO()` across
    timezones. */
function todayLabel(iso: string, en: boolean): string {
  const [y, m, d] = iso.split('-').map(Number);
  return en ? `${M_EN[m - 1]} ${d}, ${y}` : `${d} ב${M_HE[m - 1]} ${y}`;
}
const shortDate = (iso: string | null) => { if (!iso) return '—'; const p = iso.split('-'); return `${Number(p[2])} ${M_HE[Number(p[1]) - 1]}`; };

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtMin = (m: number) => `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
const sessionHe = (key: string) => sessionLabel(key);
const fmtR = (r: number) => `${r >= 0 ? '+' : '-'}${Math.abs(r).toFixed(1)}R`;

function conditionValueComplete(ct: ConditionType, cv: ConditionValue = {}): boolean {
  switch (ct) {
    case 'max_trades_per_day': return cv.max != null && cv.max > 0;
    case 'max_risk_per_trade':
    case 'max_daily_loss': return cv.maxUsd != null && cv.maxUsd > 0;
    case 'stop_after_losses': return cv.losses != null && cv.losses > 0;
    case 'allowed_hours': return cv.startMin != null && cv.endMin != null;
    case 'allowed_sessions': return !!cv.sessions?.length;
    case 'allowed_symbols': return !!cv.symbols?.length;
    case 'no_trade_around_news': return cv.beforeMin != null || cv.afterMin != null;
    case 'required_confirmations': return !!cv.tags?.length;
    default: return false;
  }
}

function conditionSummary(rule: Rule): string | null {
  if (rule.verificationMode !== 'automatic' || !rule.conditionType) return null;
  const cv = rule.conditionValue ?? {};
  switch (rule.conditionType) {
    case 'max_trades_per_day': return `מקסימום ${cv.max} עסקאות ביום`;
    case 'max_risk_per_trade': return `מקסימום סיכון $${cv.maxUsd} לעסקה`;
    case 'max_daily_loss': return `מקסימום הפסד יומי $${cv.maxUsd}`;
    case 'stop_after_losses': return `עצירה אחרי ${cv.losses} הפסדים`;
    case 'allowed_hours': return cv.startMin != null && cv.endMin != null ? `שעות מותרות ${fmtMin(cv.startMin)}–${fmtMin(cv.endMin)}` : 'שעות מותרות';
    case 'allowed_sessions': return `סשנים מותרים: ${(cv.sessions ?? []).map(sessionHe).join(', ')}`;
    case 'allowed_symbols': return `נכסים מותרים: ${(cv.symbols ?? []).join(', ')}`;
    case 'no_trade_around_news': return `אין מסחר ${cv.beforeMin ?? 0} דק׳ לפני / ${cv.afterMin ?? 0} דק׳ אחרי חדשות`;
    case 'required_confirmations': return `אישורים נדרשים: ${(cv.tags ?? []).join(', ')}`;
    default: return null;
  }
}

function perfSummaryOf(perf: RulePerformance): string {
  const total = perf.followedTrades + perf.violatedTrades;
  if (total === 0) return 'אין עדיין נתונים על החוק הזה';
  const pct = Math.round((perf.followedTrades / total) * 100);
  if (perf.hasEnough && perf.followedAvgR != null) return `${pct}% נשמר · ${fmtR(perf.followedAvgR)} ממוצע כשנשמר`;
  return `${pct}% נשמר · מדגם קטן (${perf.sampleSize} שנסגרו)`;
}

// ── Primitives (mapped from the design system) ───────────────────────────────
function Metric({ label, value, tone = 'white', size = 'sm' }: { label: string; value: string; tone?: string; size?: 'sm' | 'md' }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">{label}</span>
      <span style={{ color: TONE[tone] ?? TONE.white, fontFamily: 'var(--serif)', fontSize: size === 'md' ? 34 : 22, fontWeight: 800, lineHeight: 1 }}>{value}</span>
    </div>
  );
}

function Kicker({ children, color = GOLD }: { children: React.ReactNode; color?: string }) {
  return <span className="font-mono text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color }}>{children}</span>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-0.5 rounded-sm border font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white/55" style={{ borderColor: BORDER_STRONG }}>{children}</span>;
}

function Segmented<T extends string>({ options, value, onChange, tone = 'gold' }: { options: { key: T; he: string }[]; value: T; onChange: (v: T) => void; tone?: 'gold' | 'white' }) {
  const c = tone === 'gold' ? GOLD : '#fff';
  const bg = tone === 'gold' ? 'rgba(212,175,55,0.14)' : 'rgba(255,255,255,0.08)';
  return (
    <div className="flex flex-wrap gap-1 p-1 rounded-sm border" style={{ borderColor: BORDER_STRONG, background: RAISED }}>
      {options.map(o => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className="flex-1 min-w-[74px] px-2.5 py-1.5 rounded-sm font-mono text-[11px] font-bold transition-colors"
            style={{ background: active ? bg : 'transparent', color: active ? c : 'rgba(255,255,255,0.45)' }}
          >
            {o.he}
          </button>
        );
      })}
    </div>
  );
}

function Pill({ active, color, onClick, children }: { active: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  const c = color ?? GOLD;
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-sm font-mono text-[11px] font-bold border transition-colors"
      style={{ borderColor: active ? c + '80' : '#222', color: active ? c : 'rgba(255,255,255,0.4)', background: active ? c + '14' : 'transparent' }}
    >
      {children}
    </button>
  );
}

// ── Rule card (accordion) ────────────────────────────────────────────────────
function RuleCard({ rule, perf, history, trades, expanded, todayReported, onToggleExpand, onToggleActive, onDelete, onReport }: {
  rule: Rule;
  perf: RulePerformance;
  history: RuleHistory;
  trades: TradeEntry[];
  expanded: boolean;
  todayReported: 'followed' | 'violated' | null;
  onToggleExpand: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onReport: (status: 'followed' | 'violated') => void;
}) {
  const active = rule.isActive;
  const sev = sevMeta(ruleSeverity(rule));
  const mode = ruleVerification(rule);
  const isCritical = ruleSeverity(rule) === 'critical';
  const summary = conditionSummary(rule);
  const impact = ruleImpact(perf);
  const confidence = ruleConfidence(perf);
  const insight = ruleInsight(rule, perf, history.violationDates, trades);
  const total = perf.followedTrades + perf.violatedTrades;
  const notAutoCheckable = mode === 'automatic' && rule.conditionType != null && !AUTO_SUPPORTED.includes(rule.conditionType);

  return (
    <div
      style={{
        background: expanded ? '#111113' : SURFACE,
        border: `1px solid ${expanded ? BORDER_STRONG : BORDER}`,
        borderInlineStart: `2px solid ${isCritical ? 'rgba(212,175,55,0.45)' : 'transparent'}`,
        borderRadius: 12,
        boxShadow: expanded ? '0 12px 40px -10px rgba(212,175,55,0.18)' : 'none',
        transition: 'background 260ms var(--ease-smooth), border-color 220ms var(--ease-smooth), box-shadow 260ms var(--ease-smooth)',
        overflow: 'hidden',
        opacity: active ? 1 : 0.55,
      }}
    >
      {/* Collapsed header */}
      <div onClick={onToggleExpand} className="flex items-center justify-between gap-4 px-6 py-5 cursor-pointer flex-wrap max-[880px]:px-4">
        <div className="flex flex-col gap-1.5 min-w-[220px] flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span style={{ fontFamily: 'var(--serif)', fontSize: 17, fontWeight: isCritical ? 800 : 700, color: '#fff' }}>{ruleTitle(rule)}</span>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: sev.color }} />
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: sev.color }}>{sev.he}</span>
            <Badge>{catLabel(rule.category)}</Badge>
            <span className="font-mono text-[10px] font-bold tracking-[0.1em]" style={{ color: impact.color }}>· {impact.label}</span>
          </div>
          <span className="font-mono text-[12px] font-semibold text-white/55">{perfSummaryOf(perf)}</span>
          <span className="font-mono text-[11px] font-semibold text-white/40">
            רצף נוכחי: {history.streak > 0 ? history.streak : '—'} · נשמר לאחרונה: {shortDate(history.lastFollowed)} · הופר לאחרונה: {shortDate(history.lastViolated)}
          </span>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div onClick={e => { e.stopPropagation(); onToggleActive(); }} className="flex items-center gap-[7px] cursor-pointer p-1">
            <span className="w-2 h-2 rounded-full" style={{ background: active ? GOLD : 'rgba(255,255,255,0.4)', boxShadow: active ? '0 0 8px rgba(212,175,55,0.7)' : 'none' }} />
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: active ? GOLD : 'rgba(255,255,255,0.4)' }}>{active ? 'פעיל' : 'מושהה'}</span>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="w-7 h-7 rounded-full border grid place-items-center shrink-0 text-white/55 hover:text-[#c98080] transition-colors"
            style={{ borderColor: BORDER_STRONG }}
            aria-label="מחק חוק"
          >
            <span className="text-[13px] leading-none">×</span>
          </button>
          <div className="w-7 h-7 rounded-full border grid place-items-center shrink-0" style={{ borderColor: BORDER_STRONG, transform: `rotate(${expanded ? 180 : 0}deg)`, transition: 'transform 280ms var(--ease-expo-out)' }}>
            <span className="text-[11px] text-white/55 leading-none">▾</span>
          </div>
        </div>
      </div>

      {/* Expanding panel */}
      <div style={{ display: 'grid', gridTemplateRows: expanded ? '1fr' : '0fr', transition: 'grid-template-rows 320ms var(--ease-expo-out)' }}>
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          <div className="flex flex-col gap-6 px-6 pb-7 pt-0.5 max-[880px]:px-4" style={{ borderTop: `1px solid ${BORDER}`, marginTop: 2 }}>

            {(rule.reason || summary) && (
              <div className="pt-5 flex flex-col gap-2">
                {rule.reason && <p className="m-0 text-[14px] leading-relaxed text-[#c0c0c0] max-w-[620px]">{rule.reason}</p>}
                {summary && <span className="font-mono text-[12px] text-white/45">{summary}</span>}
              </div>
            )}

            {/* Performance — association only, gated on sample size */}
            <div className="flex flex-col gap-3">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">ביצועים</span>
              {notAutoCheckable ? (
                <p className="m-0 font-mono text-[12px] text-white/40">התנאי הזה עדיין לא נבדק אוטומטית — נבדק ידנית.</p>
              ) : perf.hasEnough && perf.followedAvgR != null && perf.violatedAvgR != null ? (
                <>
                  <div className="flex flex-wrap gap-9">
                    <Metric label="נשמר" value={String(perf.followedTrades)} tone="white" />
                    <Metric label="הופר" value={String(perf.violatedTrades)} tone="white" />
                    <Metric label="R ממוצע · נשמר" value={fmtR(perf.followedAvgR)} tone="long" />
                    <Metric label="R ממוצע · הופר" value={fmtR(perf.violatedAvgR)} tone="short" />
                    <Metric label="רמת ביטחון" value={confidenceLabel(confidence)} tone="gold" />
                  </div>
                  <p className="m-0 font-mono text-[11px] text-white/35">מבוסס על {perf.sampleSize} עסקאות שנסגרו.</p>
                </>
              ) : total > 0 ? (
                <>
                  <div className="flex flex-wrap gap-9">
                    <Metric label="נשמר" value={String(perf.followedTrades)} tone="white" />
                    <Metric label="הופר" value={String(perf.violatedTrades)} tone="white" />
                    <Metric label="רמת ביטחון" value={confidenceLabel(confidence)} tone="gold" />
                  </div>
                  <p className="m-0 font-mono text-[12px] text-white/40">עדיין אין מספיק נתונים להשוואה אמינה. (מבוסס על {perf.sampleSize} עסקאות שנסגרו)</p>
                </>
              ) : (
                <p className="m-0 font-mono text-[12px] text-white/40">אין עדיין מספיק נתונים — המשך לתעד כדי לפתוח סטטיסטיקת ביצועים.</p>
              )}
            </div>

            {/* Recent violations — real evidence from the engine / your reports */}
            {history.recentViolations.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">הפרות אחרונות</span>
                {history.recentViolations.map(v => (
                  <div key={v.date} className="flex items-baseline gap-2.5">
                    <span className="w-[5px] h-[5px] rounded-full shrink-0 -translate-y-0.5" style={{ background: '#8b3a3a' }} />
                    <span className="font-mono text-[11px] font-bold text-white/40 shrink-0">{shortDate(v.date)}</span>
                    <span className="text-[13px] text-[#c0c0c0] leading-snug">{v.evidence || '—'}</span>
                  </div>
                ))}
              </div>
            )}

            {/* AI insight — one sentence, grounded only in this rule's own numbers */}
            <div className="rounded-lg p-4" style={{ background: 'rgba(212,175,55,.08)', border: '1px solid rgba(212,175,55,.22)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span style={{ color: GOLD, fontSize: 12 }}>◈</span>
                <Kicker>תובנת AI</Kicker>
              </div>
              <p className="m-0 text-[13.5px] leading-relaxed text-[#c0c0c0]">{insight.text}</p>
            </div>

            {/* Manual reporting — only for user-report rules */}
            {mode === 'user_report' && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">דיווח היום:</span>
                <button
                  onClick={() => onReport('followed')}
                  className={`font-mono text-[11px] px-3 py-1.5 rounded-sm border transition-colors ${todayReported === 'followed' ? 'border-[#22c55e]/50 text-[#22c55e] bg-[#22c55e]/10' : 'border-[#222] text-white/40 hover:text-[#22c55e]/80 hover:border-[#22c55e]/30'}`}
                >
                  עמדתי
                </button>
                <button
                  onClick={() => onReport('violated')}
                  className={`font-mono text-[11px] px-3 py-1.5 rounded-sm border transition-colors ${todayReported === 'violated' ? 'border-[#8b3a3a]/60 text-[#c98080] bg-[#8b3a3a]/10' : 'border-[#222] text-white/40 hover:text-[#c98080] hover:border-[#8b3a3a]/40'}`}
                >
                  הפרתי
                </button>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

// ── Discipline sidebar ───────────────────────────────────────────────────────
const rateColor = (r: number | null) => (r == null ? '#52525b' : r >= 80 ? '#22c55e' : r >= 60 ? GOLD : '#ef4444');

function DisciplinePanel({ stats }: { stats: RuleStatsResult }) {
  const trend = stats.weekTrend;
  return (
    <div className="flex flex-col gap-[18px] p-6 rounded-xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
      <Kicker>סקירת משמעת</Kicker>
      <Metric label="משמעת היום" value={stats.today.rate == null ? '—' : `${Math.round(stats.today.rate)}%`} tone="gold" size="md" />
      <div className="h-px" style={{ background: BORDER }} />
      <div className="flex flex-wrap gap-6">
        <Metric label="נשמר היום" value={stats.today.evaluated === 0 ? '—' : `${stats.today.followed} / ${stats.today.evaluated}`} />
        <Metric label="השבוע" value={stats.week.rate == null ? '—' : `${Math.round(stats.week.rate)}%`} />
        <Metric label="החודש" value={stats.month.rate == null ? '—' : `${Math.round(stats.month.rate)}%`} />
      </div>
      <div className="h-px" style={{ background: BORDER }} />
      <div className="flex flex-wrap gap-6">
        <Metric label="מגמה שבועית" value={trend == null ? '—' : `${trend >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(trend))} נק׳`} tone={trend == null ? 'muted' : trend >= 0 ? 'long' : 'short'} />
        <Metric label="רצף ימים נקי" value={String(stats.streak)} tone={stats.streak >= 3 ? 'long' : 'white'} />
      </div>
      {stats.week.evaluated > 0 && (
        <p className="m-0 font-mono text-[10px] text-white/30">מבוסס על {stats.week.evaluated} בדיקות השבוע · {stats.month.evaluated} החודש.</p>
      )}

      {/* Last 14 days */}
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">14 הימים האחרונים</span>
        <div className="flex items-end gap-1 h-12" dir="ltr">
          {stats.daily.map(d => (
            <div
              key={d.date}
              className="flex-1 rounded-t-sm"
              style={{ height: d.rate == null ? 6 : 8 + (d.rate / 100) * 40, background: rateColor(d.rate), opacity: d.rate == null ? 0.25 : 0.85 }}
              title={`${d.date}: ${d.rate == null ? 'אין נתונים' : Math.round(d.rate) + '%'}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function RulesPage() {
  const { lang } = useLanguage();
  const en = lang === 'en';
  const [rules, setRules] = useState<Rule[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [userChecks, setUserChecks] = useState<RuleCheck[]>([]);
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draft, setDraft] = useState<Rule>(emptyDraft());
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Rule | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  function emptyDraftReset() { setDraft(emptyDraft()); setShowAdvanced(false); setFormError(''); }

  useEffect(() => {
    const r = localStorage.getItem(STORAGE_KEY);
    if (r) try { setRules((JSON.parse(r) as Rule[]).filter(x => !x.deleted)); } catch { /* ignore */ }
    const v = localStorage.getItem(VIOLATIONS_KEY);
    if (v) try {
      const migrated = ensureVioIds(JSON.parse(v));
      localStorage.setItem(VIOLATIONS_KEY, JSON.stringify(migrated));
      setViolations(migrated.filter(x => !x.deleted));
    } catch { /* ignore */ }
    const c = localStorage.getItem(CHECKS_KEY);
    if (c) try { setUserChecks((JSON.parse(c) as RuleCheck[]).filter(x => !x.deleted)); } catch { /* ignore */ }

    setTrades(loadTrades());
    hydrateList<Rule>('rules', STORAGE_KEY).then(setRules).catch(() => {});
    hydrateList<Violation>('violations', VIOLATIONS_KEY).then(setViolations).catch(() => {});
    hydrateList<RuleCheck>('rule_checks', CHECKS_KEY).then(setUserChecks).catch(() => {});
  }, []);

  function persistRules(updated: Rule[]) { setRules(updated); void commitList<Rule>('rules', STORAGE_KEY, updated); }
  function persistViolations(updated: Violation[]) { setViolations(updated); void commitList<Violation>('violations', VIOLATIONS_KEY, updated); }
  function persistChecks(updated: RuleCheck[]) { setUserChecks(updated); void commitList<RuleCheck>('rule_checks', CHECKS_KEY, updated); }

  function saveNewRule() {
    const title = (draft.title ?? '').trim();
    if (!title) { setFormError('חובה להזין שם לחוק'); return; }
    if (draft.verificationMode === 'automatic') {
      if (!draft.conditionType) { setFormError('בחר תנאי מובנה לבדיקה אוטומטית'); return; }
      if (!conditionValueComplete(draft.conditionType, draft.conditionValue)) { setFormError('השלם את פרטי התנאי שבחרת'); return; }
    }
    const now = Date.now();
    // Mirror title → text so legacy readers (e.g. What-If's rule labels) keep working.
    persistRules([{ ...draft, id: now.toString(), title, text: title, isActive: true, createdAt: now, updatedAt: now }, ...rules]);
    setShowAdd(false);
    emptyDraftReset();
  }

  function toggleRule(id: string) { persistRules(rules.map(r => r.id === id ? { ...r, isActive: !r.isActive, updatedAt: Date.now() } : r)); }
  function deleteRule(id: string) {
    persistRules(rules.filter(r => r.id !== id));
    persistViolations(violations.filter(v => v.ruleId !== id));
    persistChecks(userChecks.filter(c => c.ruleId !== id));
  }

  function reportToday(rule: Rule, status: 'followed' | 'violated') {
    const date = todayISO();
    const now = Date.now();
    const check: RuleCheck = {
      id: `${rule.id}-${date}`, ruleId: rule.id, date, status,
      detectedAt: now, source: 'user', evidence: status === 'violated' ? 'דווח ידנית כהופר' : 'דווח ידנית כנשמר', updatedAt: now,
    };
    persistChecks(upsertCheck(userChecks, check)); // dedup by (ruleId, date)

    const hadVio = violations.some(v => v.ruleId === rule.id && v.date === date);
    if (status === 'violated' && !hadVio) {
      persistViolations([...violations, { id: `${rule.id}-${now}-${Math.random().toString(36).slice(2, 8)}`, ruleId: rule.id, date }]);
    } else if (status === 'followed' && hadVio) {
      persistViolations(violations.filter(v => !(v.ruleId === rule.id && v.date === date)));
    }
  }

  const today = todayISO();
  const activeRules = rules.filter(r => r.isActive);
  const stats = useMemo(() => computeRuleStats(rules, trades, userChecks, today, violations), [rules, trades, userChecks, violations, today]);

  // Dashboard-wide insights — computed over every rule's own performance, not
  // just the currently-filtered list, so switching a filter chip never changes
  // what the sidebar says about the rule set as a whole.
  const perfByRuleId = useMemo(() => new Map(rules.map(r => [r.id, computeRulePerformance(r, trades, userChecks)])), [rules, trades, userChecks]);
  const dashboardInsights = useMemo(() => dashboardRuleInsights(rules, perfByRuleId, catLabel), [rules, perfByRuleId]);

  // Filter chips — only categories the trader actually uses.
  const usedCats = CAT_META.filter(m => rules.some(r => r.category === m.key));
  const chips: { key: string; label: string }[] = [
    { key: 'all', label: 'הכל' },
    { key: 'active', label: 'פעיל' },
    { key: 'paused', label: 'מושהה' },
    { key: 'critical', label: 'קריטי' },
    ...usedCats.map(m => ({ key: `cat:${m.key}`, label: m.he })),
  ];
  const matchFilter = (r: Rule) => {
    if (filter === 'all') return true;
    if (filter === 'active') return r.isActive;
    if (filter === 'paused') return !r.isActive;
    if (filter === 'critical') return ruleSeverity(r) === 'critical';
    if (filter.startsWith('cat:')) return r.category === filter.slice(4);
    return true;
  };
  const shown = rules.filter(matchFilter);

  const cv = draft.conditionValue ?? {};
  const setCV = (patch: Partial<ConditionValue>) => setDraft(d => ({ ...d, conditionValue: { ...(d.conditionValue ?? {}), ...patch } }));
  const toggleArr = (key: 'sessions' | 'symbols' | 'tags', val: string) =>
    setDraft(d => { const curr = d.conditionValue?.[key] ?? []; const next = curr.includes(val) ? curr.filter(x => x !== val) : [...curr, val]; return { ...d, conditionValue: { ...(d.conditionValue ?? {}), [key]: next } }; });
  const numInputCls = 'w-24 rounded-sm px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-[#d4af37]/60 border';
  const numInputStyle = { background: RAISED, borderColor: BORDER_STRONG };

  return (
    <div className="flex-1 overflow-y-auto" dir={en ? 'ltr' : 'rtl'}>
      {/* ── Topbar ── */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-5 px-6 sm:px-12 h-16 bg-[rgba(5,5,5,.82)] backdrop-blur-md border-b max-[880px]:hidden" style={{ borderColor: BORDER }}>
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">
          {en ? <>Discipline <span className="text-white/20 mx-1.5">/</span> Trading Rules</> : <>משמעת <span className="text-white/20 mx-1.5">/</span> חוקי מסחר</>}
        </span>
        <span className="font-mono text-[11px] font-semibold text-white/35" dir={en ? 'ltr' : 'rtl'}>{todayLabel(today, en)}</span>
      </div>

      <div className="max-w-[1440px] mx-auto px-12 py-14 pb-32 max-[880px]:px-5 max-[880px]:py-7 max-[880px]:pb-24 flex flex-col gap-12 max-[880px]:gap-10">

        {/* ── Hero ── */}
        <div className="relative flex items-end justify-between gap-6 flex-wrap pt-2 pb-1 overflow-hidden">
          <div className="absolute pointer-events-none z-0" style={{ inset: '-60px -40px auto -40px', height: 280, backgroundImage: WASH_GOLD }} />
          <div className="relative z-[1] flex flex-col gap-3.5 max-w-[640px]">
            <Kicker>◈ מרכז המשמעת האישי</Kicker>
            <h1 className="m-0" style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(2.2rem, 5vw, 4rem)', fontWeight: 800, color: '#fff', lineHeight: 1.05, textShadow: '0 0 60px rgba(212,175,55,0.40)' }}>
              {en ? 'Rules' : 'חוקי מסחר'}
            </h1>
            <p className="m-0 max-w-[480px] text-[14px] leading-relaxed text-[#c0c0c0]">
              הגדר את החוקים שלפיהם אתה סוחר — וראה, במספרים, אם אתה באמת עומד בהם.
            </p>
          </div>
          {!showAdd && (
            <button
              onClick={() => { emptyDraftReset(); setShowAdd(true); }}
              className="relative z-[1] px-5 py-2.5 rounded-sm bg-[#d4af37] text-black font-mono text-xs font-bold tracking-[0.12em] uppercase hover:bg-[#e3c768] transition-colors"
              style={{ boxShadow: '0 0 36px rgba(212,175,55,0.40)' }}
            >
              + חוק חדש
            </button>
          )}
        </div>

        {/* ── Overview strip ── */}
        <div className="grid grid-cols-3 max-[880px]:grid-cols-1 gap-px rounded-xl overflow-hidden" style={{ background: BORDER, border: `1px solid ${BORDER}` }}>
          {[
            { label: 'חוקים פעילים', value: String(activeRules.length), tone: 'white' },
            { label: 'משמעת היום', value: stats.today.rate == null ? '—' : `${Math.round(stats.today.rate)}%`, tone: 'gold' },
            { label: 'נשמר היום', value: stats.today.evaluated === 0 ? '—' : `${stats.today.followed} / ${stats.today.evaluated}`, tone: 'white' },
          ].map(s => (
            <div key={s.label} className="px-6 py-5" style={{ background: SURFACE }}>
              <Metric label={s.label} value={s.value} tone={s.tone} />
            </div>
          ))}
        </div>

        {/* ── Main grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-10 items-start">

          <div className="flex flex-col gap-7 min-w-0">

            {/* New rule form — animated open/close */}
            <div style={{ display: 'grid', gridTemplateRows: showAdd ? '1fr' : '0fr', transition: 'grid-template-rows 320ms var(--ease-expo-out)' }}>
              <div style={{ overflow: 'hidden', minHeight: 0 }}>
                <div className="flex flex-col gap-[18px] p-6 rounded-xl max-[880px]:p-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                  <Kicker>חוק חדש</Kicker>

                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">שם החוק *</span>
                    <input
                      value={draft.title ?? ''}
                      onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                      placeholder="לדוגמה: להמתין לאישור סשן NY AM"
                      className="w-full rounded-sm px-3 py-2.5 text-sm text-white placeholder-white/25 outline-none border focus:border-[#d4af37]/60 transition-colors"
                      style={{ background: RAISED, borderColor: BORDER_STRONG }}
                    />
                  </div>

                  <div className="grid grid-cols-2 max-[880px]:grid-cols-1 gap-[18px]">
                    <div className="flex flex-col gap-2">
                      <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">קטגוריה *</span>
                      <Segmented options={CAT_META} value={draft.category as RuleCategory} onChange={k => setDraft(d => ({ ...d, category: k }))} tone="white" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">חומרה *</span>
                      <Segmented options={SEVERITY_META} value={ruleSeverity(draft)} onChange={k => setDraft(d => ({ ...d, severity: k }))} tone="gold" />
                    </div>
                  </div>

                  <button
                    onClick={() => setShowAdvanced(v => !v)}
                    className="self-start bg-transparent border-0 p-0 cursor-pointer font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-white/40 hover:text-[#d4af37] transition-colors"
                  >
                    {showAdvanced ? '− הסתר הגדרות מתקדמות' : '+ הגדרות מתקדמות (סיבה, דרך בדיקה, תנאי, תחולה)'}
                  </button>

                  <div style={{ display: 'grid', gridTemplateRows: showAdvanced ? '1fr' : '0fr', transition: 'grid-template-rows 280ms var(--ease-expo-out)' }}>
                    <div style={{ overflow: 'hidden', minHeight: 0 }}>
                      <div className="flex flex-col gap-[18px] pt-0.5">

                        <div className="flex flex-col gap-2">
                          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">סיבת החוק</span>
                          <textarea
                            value={draft.reason ?? ''}
                            onChange={e => setDraft(d => ({ ...d, reason: e.target.value }))}
                            placeholder="למה יצרת את החוק הזה?"
                            rows={2}
                            className="w-full rounded-sm px-3 py-2.5 text-sm text-white placeholder-white/25 outline-none border focus:border-[#d4af37]/60 transition-colors resize-y leading-relaxed"
                            style={{ background: RAISED, borderColor: BORDER_STRONG }}
                          />
                        </div>

                        <div className="flex flex-col gap-2">
                          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">דרך בדיקה</span>
                          <Segmented options={VERIFY_META} value={ruleVerification(draft)} onChange={k => setDraft(d => ({ ...d, verificationMode: k }))} tone="gold" />
                        </div>

                        {draft.verificationMode === 'automatic' && (
                          <div className="flex flex-col gap-2">
                            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">תנאי מובנה</span>
                            <div className="flex gap-2 flex-wrap">
                              {CONDITION_META.map(m => <Pill key={m.key} active={draft.conditionType === m.key} onClick={() => setDraft(d => ({ ...d, conditionType: m.key, conditionValue: {} }))}>{m.he}</Pill>)}
                            </div>
                            {draft.conditionType && (
                              <div className="mt-2 flex items-center gap-2.5 flex-wrap">
                                {draft.conditionType === 'max_trades_per_day' && (
                                  <label className="font-mono text-[11px] text-white/50 flex items-center gap-2">מקסימום עסקאות
                                    <input type="number" min={1} className={numInputCls} style={numInputStyle} value={cv.max ?? ''} onChange={e => setCV({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                                )}
                                {(draft.conditionType === 'max_risk_per_trade' || draft.conditionType === 'max_daily_loss') && (
                                  <label className="font-mono text-[11px] text-white/50 flex items-center gap-2">{draft.conditionType === 'max_risk_per_trade' ? 'תקרת סיכון ($)' : 'תקרת הפסד יומי ($)'}
                                    <input type="number" min={1} className={numInputCls} style={numInputStyle} value={cv.maxUsd ?? ''} onChange={e => setCV({ maxUsd: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                                )}
                                {draft.conditionType === 'stop_after_losses' && (
                                  <label className="font-mono text-[11px] text-white/50 flex items-center gap-2">לעצור אחרי (הפסדים)
                                    <input type="number" min={1} className={numInputCls} style={numInputStyle} value={cv.losses ?? ''} onChange={e => setCV({ losses: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                                )}
                                {draft.conditionType === 'allowed_hours' && (
                                  <div className="flex items-center gap-2" dir="ltr">
                                    <input type="time" step={60} className="rounded-sm px-2 py-1.5 font-mono text-xs text-white [color-scheme:dark] outline-none border focus:border-[#d4af37]/60" style={numInputStyle} value={cv.startMin != null ? fmtMin(cv.startMin) : ''} onChange={e => { const v = e.target.value; if (!v) return setCV({ startMin: undefined }); const [h, mi] = v.split(':').map(Number); setCV({ startMin: h * 60 + mi }); }} />
                                    <span className="font-mono text-xs text-white/30">→</span>
                                    <input type="time" step={60} className="rounded-sm px-2 py-1.5 font-mono text-xs text-white [color-scheme:dark] outline-none border focus:border-[#d4af37]/60" style={numInputStyle} value={cv.endMin != null ? fmtMin(cv.endMin) : ''} onChange={e => { const v = e.target.value; if (!v) return setCV({ endMin: undefined }); const [h, mi] = v.split(':').map(Number); setCV({ endMin: h * 60 + mi }); }} />
                                  </div>
                                )}
                                {draft.conditionType === 'allowed_sessions' && activeSessions().map(s => <Pill key={s.key} active={(cv.sessions ?? []).includes(s.key)} onClick={() => toggleArr('sessions', s.key)}>{s.he}</Pill>)}
                                {draft.conditionType === 'allowed_symbols' && INSTRUMENT_KEYS.map(sym => <Pill key={sym} active={(cv.symbols ?? []).includes(sym)} onClick={() => toggleArr('symbols', sym)}>{sym}</Pill>)}
                                {draft.conditionType === 'required_confirmations' && CONFIRMATION_TAGS.map(t => <Pill key={t} active={(cv.tags ?? []).includes(t)} onClick={() => toggleArr('tags', t)}>{t}</Pill>)}
                                {draft.conditionType === 'no_trade_around_news' && (
                                  <div className="flex items-center gap-2.5 flex-wrap">
                                    <label className="font-mono text-[11px] text-white/50 flex items-center gap-2">דק׳ לפני
                                      <input type="number" min={0} className={numInputCls} style={numInputStyle} value={cv.beforeMin ?? ''} onChange={e => setCV({ beforeMin: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                                    <label className="font-mono text-[11px] text-white/50 flex items-center gap-2">דק׳ אחרי
                                      <input type="number" min={0} className={numInputCls} style={numInputStyle} value={cv.afterMin ?? ''} onChange={e => setCV({ afterMin: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                                    <span className="font-mono text-[10px] text-white/30">התנאי הזה עדיין נבדק ידנית</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex flex-col gap-2">
                          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">תחולת החוק</span>
                          <div className="flex gap-2 flex-wrap">
                            {SCOPE_META.map(m => <Pill key={m.key} active={(draft.scope ?? 'always') === m.key} onClick={() => setDraft(d => ({ ...d, scope: m.key }))}>{m.he}</Pill>)}
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>

                  {formError && <p className="m-0 font-mono text-[11px] text-[#c98080]">{formError}</p>}

                  <div className="flex items-center gap-2.5 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                    <button
                      onClick={saveNewRule}
                      disabled={!(draft.title ?? '').trim()}
                      className="px-5 py-2 rounded-sm bg-[#d4af37] text-black font-mono text-xs font-bold uppercase tracking-[0.12em] hover:bg-[#e3c768] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#d4af37] transition-colors"
                    >
                      צור חוק
                    </button>
                    <button onClick={() => { setShowAdd(false); emptyDraftReset(); }} className="px-5 py-2 rounded-sm border text-white/40 font-mono text-xs uppercase tracking-[0.12em] hover:text-white/70 transition-colors" style={{ borderColor: BORDER }}>ביטול</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Rules list */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Kicker color="rgba(255,255,255,0.55)">החוקים שלך</Kicker>
                <span className="font-mono text-[11px] font-bold tracking-[0.12em] text-white/40">{activeRules.length} פעילים</span>
              </div>

              {rules.length > 0 && (
                <div className="flex flex-wrap gap-2 pb-1.5 pt-0.5">
                  {chips.map(c => {
                    const active = filter === c.key;
                    return (
                      <button
                        key={c.key}
                        onClick={() => setFilter(c.key)}
                        className="px-3.5 py-1.5 rounded-full border font-mono text-[11px] font-bold tracking-[0.1em] transition-colors"
                        style={{
                          borderColor: active ? 'rgba(212,175,55,0.45)' : BORDER,
                          color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                          background: active ? 'rgba(212,175,55,0.08)' : 'transparent',
                        }}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {rules.length === 0 ? (
                <div className="flex flex-col items-center text-center gap-[18px] py-20 px-6 rounded-xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                  <span style={{ fontFamily: 'var(--serif)', fontSize: 34, color: GOLD, textShadow: '0 0 40px rgba(212,175,55,0.40)', lineHeight: 1 }}>◈</span>
                  <h3 className="m-0" style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 700, color: '#fff' }}>בְּנה את המשמעת שלך.</h3>
                  <p className="m-0 max-w-[420px] text-[14px] leading-relaxed text-[#c0c0c0]">
                    חוקים הופכים מסחר מתגובתיות למערכת. כתוב איך נראית משמעת — ותן ל-Onyx להראות לך אם אתה עומד בה.
                  </p>
                  <button
                    onClick={() => { emptyDraftReset(); setShowAdd(true); }}
                    className="mt-2 px-5 py-2.5 rounded-sm bg-[#d4af37] text-black font-mono text-xs font-bold uppercase tracking-[0.12em] hover:bg-[#e3c768] transition-colors"
                  >
                    צור את החוק הראשון שלך
                  </button>
                </div>
              ) : shown.length === 0 ? (
                <div className="flex flex-col items-center text-center gap-2.5 py-14 px-6 rounded-xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                  <span className="font-mono text-[13px] text-white/40">אין חוקים התואמים לסינון הנוכחי.</span>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {shown.map(rule => (
                    <RuleCard
                      key={rule.id}
                      rule={rule}
                      perf={computeRulePerformance(rule, trades, userChecks)}
                      history={computeRuleHistory(rule, trades, userChecks, today, violations)}
                      trades={trades}
                      expanded={expandedId === rule.id}
                      todayReported={(() => { const c = userChecks.find(x => x.ruleId === rule.id && x.date === today); return c && c.status !== 'unknown' ? c.status : null; })()}
                      onToggleExpand={() => setExpandedId(id => (id === rule.id ? null : rule.id))}
                      onToggleActive={() => toggleRule(rule.id)}
                      onDelete={() => setDeleteTarget(rule)}
                      onReport={status => reportToday(rule, status)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Sticky discipline sidebar ── */}
          <div className="flex flex-col gap-5 min-w-0 lg:sticky lg:top-[88px]">
            <DisciplinePanel stats={stats} />

            {dashboardInsights.length > 0 && (
              <div className="flex flex-col gap-3 p-6 rounded-xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                <Kicker>תובנות</Kicker>
                <div className="flex flex-col gap-2.5">
                  {dashboardInsights.map((text, i) => (
                    <p key={i} className="m-0 text-[13.5px] leading-relaxed text-[#c0c0c0]">{text}</p>
                  ))}
                </div>
              </div>
            )}

            {stats.topBroken.length > 0 && (
              <div className="flex flex-col gap-4 p-6 rounded-xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                <Kicker>החוקים שהופרו הכי הרבה</Kicker>
                <div className="flex flex-col gap-2.5">
                  {stats.topBroken.map(b => (
                    <div key={b.ruleId} className="flex items-center justify-between gap-3">
                      <span className="text-[13px] text-white/70 truncate">{b.title}</span>
                      <span className="font-mono text-[12px] font-bold text-[#c98080] shrink-0">{b.violated}</span>
                    </div>
                  ))}
                </div>
                <span className="font-mono text-[10px] text-white/30">30 הימים האחרונים</span>
              </div>
            )}

            <div className="flex flex-col gap-2.5 p-6 rounded-xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
              <Kicker color="rgba(255,255,255,0.55)">תובנות בינה מלאכותית</Kicker>
              <p className="m-0 text-[13px] leading-relaxed text-white/40" style={{ fontFamily: 'var(--serif)', fontStyle: 'italic' }}>
                בקרוב Onyx יראה מדוע חוקים נשברים — בהקשר של סשן, ביאס וסטאפ.
              </p>
            </div>
          </div>

        </div>

        <p className="m-0 font-mono text-[11px] text-white/30 text-center">
          {en ? 'Demo data · for research and educational purposes only.' : 'נתוני הדגמה · לצרכי מחקר ולימוד בלבד.'}
        </p>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title={en ? 'Delete rule?' : 'למחוק חוק?'}
        message={en
          ? <>This will permanently delete <span className="text-white">“{deleteTarget ? ruleTitle(deleteTarget) : ''}”</span>, including its performance and violation history.</>
          : <>פעולה זו תמחק את החוק <span className="text-white">״{deleteTarget ? ruleTitle(deleteTarget) : ''}״</span> לצמיתות, כולל היסטוריית הביצועים וההפרות שלו.</>}
        confirmLabel={en ? 'Yes, delete' : 'כן, מחק'}
        cancelLabel={en ? 'Cancel' : 'ביטול'}
        dir={en ? 'ltr' : 'rtl'}
        onConfirm={() => { if (deleteTarget) deleteRule(deleteTarget.id); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function emptyDraft(): Rule {
  return { id: '', title: '', category: 'discipline', verificationMode: 'user_report', severity: 'important', scope: 'always', conditionValue: {}, isActive: true };
}
