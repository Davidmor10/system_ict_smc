'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../../hooks/useLanguage';
import { loadTrades, todayISO } from '../../lib/journal';
import type { TradeEntry } from '../../lib/journal';
import { hydrateList, commitList } from '../../lib/sync/collections';
import ConfirmDialog from '../../components/ConfirmDialog';
import { SESS } from '../../lib/sessions';
import { INSTRUMENT_KEYS } from '../../lib/instruments';
import { AUTO_SUPPORTED } from '../../lib/rules/engine';
import { computeRulePerformance, type RulePerformance } from '../../lib/rules/performance';
import {
  ruleTitle, ruleVerification, ruleSeverity, upsertCheck,
  type Rule, type RuleCheck, type RuleCategory, type ConditionType, type ConditionValue, type RuleScope, type RuleSeverity, type VerificationMode,
} from '../../lib/rules/types';

const STORAGE_KEY = 'onyx_trading_rules';
const VIOLATIONS_KEY = 'onyx_rule_violations';
const CHECKS_KEY = 'onyx_rule_checks';

/** Legacy day-level violation (kept so the What-If simulator + daily-discipline
    stat keep reading the same shape they always have). */
interface Violation { id: string; ruleId: string; date: string; tradeNote?: string; updatedAt?: number; deleted?: boolean; }

function ensureVioIds(list: unknown): Violation[] {
  if (!Array.isArray(list)) return [];
  return list.map((v, i) => (v?.id ? v : { ...v, id: `${v?.ruleId ?? 'v'}-${v?.date ?? ''}-${i}-${Math.random().toString(36).slice(2, 8)}` })) as Violation[];
}

// ── Metadata (fixed per category/severity — never per-rule/user-chosen) ──────
const CAT_META: { key: RuleCategory; he: string; en: string; color: string }[] = [
  { key: 'discipline', he: 'משמעת', en: 'Discipline', color: '#d4af37' },
  { key: 'entry', he: 'כניסה', en: 'Entry', color: '#3b82f6' },
  { key: 'trade_mgmt', he: 'ניהול עסקה', en: 'Trade Mgmt', color: '#22c55e' },
  { key: 'risk', he: 'ניהול סיכון', en: 'Risk', color: '#ef4444' },
  { key: 'time', he: 'זמן', en: 'Time', color: '#a855f7' },
  { key: 'news', he: 'חדשות', en: 'News', color: '#f59e0b' },
];
const LEGACY_CAT_HE: Record<string, string> = { exit: 'ניהול עסקה' };
const catColor = (c: string) => CAT_META.find(m => m.key === c)?.color ?? '#8b8b8b';
const catLabel = (c: string, en: boolean) => { const m = CAT_META.find(x => x.key === c); return m ? (en ? m.en : m.he) : (LEGACY_CAT_HE[c] ?? c); };

const SEVERITY_META: { key: RuleSeverity; he: string; color: string }[] = [
  { key: 'recommendation', he: 'המלצה', color: '#7a8fa8' },
  { key: 'important', he: 'חשוב', color: '#d4af37' },
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
const condHe = (c: ConditionType) => CONDITION_META.find(m => m.key === c)?.he ?? c;

const SCOPE_META: { key: RuleScope; he: string }[] = [
  { key: 'always', he: 'תמיד' },
  { key: 'per_symbol', he: 'לפי נכס' },
  { key: 'per_session', he: 'לפי סשן' },
  { key: 'per_day', he: 'לפי יום' },
  { key: 'per_hour', he: 'לפי שעה' },
  { key: 'around_news', he: 'סביב חדשות' },
];

const CONFIRMATION_TAGS = ['SMT', 'IFVG', 'CISD', 'ORDER_BLOCK'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtMin = (m: number) => `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
const sessionHe = (key: string) => SESS.find(s => s.key === key)?.he ?? key;
const CONF_LABEL: Record<string, string> = { low: 'ביטחון נמוך', medium: 'ביטחון בינוני', high: 'ביטחון גבוה' };

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

const fmtR = (r: number) => `${r >= 0 ? '' : '-'}${Math.abs(r).toFixed(1)}R`;

// ── Rule card ────────────────────────────────────────────────────────────────
function RuleCard({ rule, perf, todayReported, onToggle, onDelete, onReport }: {
  rule: Rule;
  perf: RulePerformance;
  todayReported: 'followed' | 'violated' | null;
  onToggle: () => void;
  onDelete: () => void;
  onReport: (status: 'followed' | 'violated') => void;
}) {
  const active = rule.isActive;
  const sev = sevMeta(ruleSeverity(rule));
  const mode = ruleVerification(rule);
  const summary = conditionSummary(rule);
  const notAutoCheckable = mode === 'automatic' && rule.conditionType != null && !AUTO_SUPPORTED.includes(rule.conditionType);
  const someData = perf.followedTrades + perf.violatedTrades > 0;

  return (
    <div className={`border rounded-sm p-4 transition-opacity ${active ? 'border-[#1c1c1e] bg-[#0a0a0b]' : 'border-[#111] bg-[#070708] opacity-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-2" style={{ background: catColor(rule.category) }} />
          <div className="min-w-0">
            <p className={`text-sm font-bold ${active ? 'text-white' : 'text-white/40'}`} dir="rtl">{ruleTitle(rule)}</p>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: catColor(rule.category) + 'cc' }}>{catLabel(rule.category, false)}</span>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: sev.color }}>{sev.he}</span>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">{VERIFY_META.find(v => v.key === mode)?.he}</span>
            </div>
            {summary && <p className="font-mono text-[11px] text-white/40 mt-1.5" dir="rtl">{summary}</p>}
            {rule.reason && <p className="text-[12px] text-white/35 mt-1 leading-relaxed" dir="rtl">״{rule.reason}״</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onToggle}
            className={`font-mono text-[9px] font-bold uppercase tracking-[0.14em] px-2 py-0.5 rounded-sm border transition-colors ${active ? 'border-[#22c55e]/30 text-[#22c55e]/70 hover:border-[#ef4444]/30 hover:text-[#ef4444]/70' : 'border-[#333] text-white/30 hover:text-white/60'}`}
          >
            {active ? 'ON' : 'OFF'}
          </button>
          <button onClick={onDelete} className="text-white/25 hover:text-[#8b3a3a] transition-colors p-1" aria-label="מחק חוק">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
          </button>
        </div>
      </div>

      {/* Performance — association only, gated on sample size */}
      {active && (
        <div className="mt-3 pt-3 border-t border-[#111]">
          {notAutoCheckable ? (
            <p className="font-mono text-[11px] text-white/30" dir="rtl">התנאי הזה עדיין לא נבדק אוטומטית — נבדק ידנית.</p>
          ) : perf.hasEnough && perf.followedAvgR != null && perf.violatedAvgR != null ? (
            <div dir="rtl">
              <p className="text-[13px] text-white/80 leading-relaxed">
                כשעמדת על החוק: <span className="font-mono font-bold" style={{ color: '#6fa580' }}>{fmtR(perf.followedAvgR)}</span> בממוצע.{' '}
                כשהפרת אותו: <span className="font-mono font-bold" style={{ color: '#c98080' }}>{fmtR(perf.violatedAvgR)}</span>.
              </p>
              <p className="font-mono text-[10px] text-white/35 mt-1.5">
                מבוסס על {perf.sampleSize} עסקאות מוכרעות · נשמר {perf.followedTrades} · הופר {perf.violatedTrades} · {CONF_LABEL[perf.confidence.level]}
              </p>
            </div>
          ) : someData ? (
            <p className="font-mono text-[11px] text-white/35" dir="rtl">
              עדיין אין מספיק נתונים להשוואה אמינה. (מבוסס על {perf.sampleSize} עסקאות מוכרעות)
            </p>
          ) : (
            <p className="font-mono text-[11px] text-white/25" dir="rtl">עדיין אין נתונים על החוק הזה.</p>
          )}

          {/* Manual reporting — only for user-report rules */}
          {mode === 'user_report' && (
            <div className="flex items-center gap-2 mt-3">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">דיווח היום:</span>
              <button
                onClick={() => onReport('followed')}
                className={`font-mono text-[10px] px-2.5 py-1 rounded-sm border transition-colors ${todayReported === 'followed' ? 'border-[#22c55e]/50 text-[#22c55e] bg-[#22c55e]/10' : 'border-[#222] text-white/40 hover:text-[#22c55e]/80 hover:border-[#22c55e]/30'}`}
              >
                עמדתי
              </button>
              <button
                onClick={() => onReport('violated')}
                className={`font-mono text-[10px] px-2.5 py-1 rounded-sm border transition-colors ${todayReported === 'violated' ? 'border-[#8b3a3a]/60 text-[#c98080] bg-[#8b3a3a]/10' : 'border-[#222] text-white/40 hover:text-[#c98080] hover:border-[#8b3a3a]/40'}`}
              >
                הפרתי
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Selectable pill button (used everywhere instead of dropdowns) ────────────
function Pill({ active, color, onClick, children }: { active: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  const c = color ?? '#d4af37';
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-sm font-mono text-[11px] font-bold border transition-colors"
      style={{
        borderColor: active ? c + '80' : '#222',
        color: active ? c : 'rgba(255,255,255,0.4)',
        background: active ? c + '14' : 'transparent',
      }}
    >
      {children}
    </button>
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

  function emptyDraftReset() { setDraft(emptyDraft()); setShowAdvanced(false); setFormError(''); }

  useEffect(() => {
    // Instant paint from cache, then cloud reconcile (cross-device).
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
    persistRules([...rules, { ...draft, id: now.toString(), title, text: title, isActive: true, createdAt: now, updatedAt: now }]);
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

    // Keep the legacy day-level violation store consistent (What-If + daily discipline read it).
    const hadVio = violations.some(v => v.ruleId === rule.id && v.date === date);
    if (status === 'violated' && !hadVio) {
      persistViolations([...violations, { id: `${rule.id}-${now}-${Math.random().toString(36).slice(2, 8)}`, ruleId: rule.id, date }]);
    } else if (status === 'followed' && hadVio) {
      persistViolations(violations.filter(v => !(v.ruleId === rule.id && v.date === date)));
    }
  }

  const today = todayISO();
  const todayViolationCount = violations.filter(v => v.date === today).length;
  const activeRules = rules.filter(r => r.isActive);
  const complianceToday = activeRules.length > 0 ? Math.round(((activeRules.length - todayViolationCount) / activeRules.length) * 100) : 100;

  const knownCats = CAT_META.map(m => m.key as string);
  const groups = [
    ...CAT_META.map(m => ({ key: m.key, label: en ? m.en : m.he, color: m.color, rules: rules.filter(r => r.category === m.key) })),
    { key: '__other', label: en ? 'Other' : 'אחר', color: '#8b8b8b', rules: rules.filter(r => !knownCats.includes(r.category)) },
  ].filter(g => g.rules.length > 0);

  const cv = draft.conditionValue ?? {};
  const setCV = (patch: Partial<ConditionValue>) => setDraft(d => ({ ...d, conditionValue: { ...(d.conditionValue ?? {}), ...patch } }));
  const toggleArr = (key: 'sessions' | 'symbols' | 'tags', val: string) =>
    setDraft(d => { const curr = d.conditionValue?.[key] ?? []; const next = curr.includes(val) ? curr.filter(x => x !== val) : [...curr, val]; return { ...d, conditionValue: { ...(d.conditionValue ?? {}), [key]: next } }; });
  const numInputCls = 'w-24 bg-[#111] border border-[#222] rounded-sm px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-[#d4af37]/40';

  return (
    <div className="flex-1 overflow-y-auto" dir={en ? 'ltr' : 'rtl'}>
      <div className="px-8 max-[880px]:px-4 py-8 pb-24 max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-serif text-3xl font-bold text-white">{en ? 'Rules' : 'חוקי מסחר'}</h1>
            <p className="font-mono text-xs text-white/30 mt-1 uppercase tracking-[0.18em]">{activeRules.length} active rules</p>
          </div>
          {!showAdd && (
            <button
              onClick={() => { emptyDraftReset(); setShowAdd(true); }}
              className="px-5 py-2.5 rounded-sm bg-[#d4af37] text-black font-mono text-xs font-bold tracking-[0.12em] uppercase hover:bg-[#e5c84a] transition-colors [box-shadow:0_0_24px_rgba(212,175,55,0.3)]"
            >
              {en ? '+ Add Rule' : '+ חוק חדש'}
            </button>
          )}
        </div>

        {/* Daily compliance */}
        {activeRules.length > 0 && (
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[140px] px-5 py-4 border border-[#1c1c1e] rounded-sm bg-[#0a0a0b]">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-2">Today&apos;s Discipline</p>
              <p className="font-serif text-3xl font-bold" style={{ color: complianceToday >= 80 ? '#22c55e' : complianceToday >= 60 ? '#d4af37' : '#ef4444' }}>{complianceToday}%</p>
              <p className="font-mono text-[10px] text-white/30 mt-1">{todayViolationCount} violations today</p>
            </div>
            <div className="flex-1 min-w-[140px] px-5 py-4 border border-[#1c1c1e] rounded-sm bg-[#0a0a0b]">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-2">Active Rules</p>
              <p className="font-serif text-3xl font-bold text-white">{activeRules.length}</p>
              <p className="font-mono text-[10px] text-white/30 mt-1">{rules.length - activeRules.length} paused</p>
            </div>
          </div>
        )}

        {/* Add rule form — short by default, advanced fields reveal on demand */}
        {showAdd && (
          <div className="border border-[#d4af37]/20 rounded-sm bg-[#0a0a0b] p-5 space-y-5" dir="rtl">
            {/* Name */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-white/40 mb-1.5">שם החוק *</label>
              <input
                value={draft.title ?? ''}
                onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                placeholder="למשל: לא לסחור אחרי 2 הפסדים ביום"
                className="w-full bg-[#111] border border-[#222] rounded-sm px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-[#d4af37]/40 transition-colors"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-white/40 mb-1.5">סוג החוק *</label>
              <div className="flex gap-2 flex-wrap">
                {CAT_META.map(m => <Pill key={m.key} active={draft.category === m.key} color={m.color} onClick={() => setDraft(d => ({ ...d, category: m.key }))}>{m.he}</Pill>)}
              </div>
            </div>

            {/* Severity */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-white/40 mb-1.5">חומרה *</label>
              <div className="flex gap-2 flex-wrap">
                {SEVERITY_META.map(m => <Pill key={m.key} active={ruleSeverity(draft) === m.key} color={m.color} onClick={() => setDraft(d => ({ ...d, severity: m.key }))}>{m.he}</Pill>)}
              </div>
            </div>

            {/* Advanced toggle */}
            <button onClick={() => setShowAdvanced(v => !v)} className="font-mono text-[11px] text-[#d4af37]/70 hover:text-[#d4af37] transition-colors">
              {showAdvanced ? '− הסתר הגדרות מתקדמות' : '+ הגדרות מתקדמות (דרך בדיקה, תנאי, תחולה, סיבה)'}
            </button>

            {showAdvanced && (
              <div className="space-y-5 pt-1">
                {/* Verification */}
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-white/40 mb-1.5">דרך בדיקה</label>
                  <div className="flex gap-2 flex-wrap">
                    {VERIFY_META.map(m => <Pill key={m.key} active={ruleVerification(draft) === m.key} onClick={() => setDraft(d => ({ ...d, verificationMode: m.key }))}>{m.he}</Pill>)}
                  </div>
                </div>

                {/* Condition — only for automatic */}
                {draft.verificationMode === 'automatic' && (
                  <div>
                    <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-white/40 mb-1.5">תנאי מובנה</label>
                    <div className="flex gap-2 flex-wrap">
                      {CONDITION_META.map(m => <Pill key={m.key} active={draft.conditionType === m.key} onClick={() => setDraft(d => ({ ...d, conditionType: m.key, conditionValue: {} }))}>{m.he}</Pill>)}
                    </div>

                    {/* Only the value fields for the chosen condition */}
                    {draft.conditionType && (
                      <div className="mt-3 flex items-center gap-2.5 flex-wrap">
                        {draft.conditionType === 'max_trades_per_day' && (
                          <label className="font-mono text-[11px] text-white/50 flex items-center gap-2">מקסימום עסקאות
                            <input type="number" min={1} className={numInputCls} value={cv.max ?? ''} onChange={e => setCV({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                        )}
                        {draft.conditionType === 'max_risk_per_trade' && (
                          <label className="font-mono text-[11px] text-white/50 flex items-center gap-2">תקרת סיכון ($)
                            <input type="number" min={1} className={numInputCls} value={cv.maxUsd ?? ''} onChange={e => setCV({ maxUsd: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                        )}
                        {draft.conditionType === 'max_daily_loss' && (
                          <label className="font-mono text-[11px] text-white/50 flex items-center gap-2">תקרת הפסד יומי ($)
                            <input type="number" min={1} className={numInputCls} value={cv.maxUsd ?? ''} onChange={e => setCV({ maxUsd: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                        )}
                        {draft.conditionType === 'stop_after_losses' && (
                          <label className="font-mono text-[11px] text-white/50 flex items-center gap-2">לעצור אחרי (הפסדים)
                            <input type="number" min={1} className={numInputCls} value={cv.losses ?? ''} onChange={e => setCV({ losses: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                        )}
                        {draft.conditionType === 'allowed_hours' && (
                          <div className="flex items-center gap-2" dir="ltr">
                            <input type="time" step={60} className="bg-[#111] border border-[#222] rounded-sm px-2 py-1.5 font-mono text-xs text-white [color-scheme:dark] outline-none focus:border-[#d4af37]/40" value={cv.startMin != null ? fmtMin(cv.startMin) : ''} onChange={e => { const v = e.target.value; if (!v) return setCV({ startMin: undefined }); const [h, mi] = v.split(':').map(Number); setCV({ startMin: h * 60 + mi }); }} />
                            <span className="font-mono text-xs text-white/30">→</span>
                            <input type="time" step={60} className="bg-[#111] border border-[#222] rounded-sm px-2 py-1.5 font-mono text-xs text-white [color-scheme:dark] outline-none focus:border-[#d4af37]/40" value={cv.endMin != null ? fmtMin(cv.endMin) : ''} onChange={e => { const v = e.target.value; if (!v) return setCV({ endMin: undefined }); const [h, mi] = v.split(':').map(Number); setCV({ endMin: h * 60 + mi }); }} />
                          </div>
                        )}
                        {draft.conditionType === 'allowed_sessions' && SESS.map(s => <Pill key={s.key} active={(cv.sessions ?? []).includes(s.key)} onClick={() => toggleArr('sessions', s.key)}>{s.he}</Pill>)}
                        {draft.conditionType === 'allowed_symbols' && INSTRUMENT_KEYS.map(sym => <Pill key={sym} active={(cv.symbols ?? []).includes(sym)} onClick={() => toggleArr('symbols', sym)}>{sym}</Pill>)}
                        {draft.conditionType === 'required_confirmations' && CONFIRMATION_TAGS.map(t => <Pill key={t} active={(cv.tags ?? []).includes(t)} onClick={() => toggleArr('tags', t)}>{t}</Pill>)}
                        {draft.conditionType === 'no_trade_around_news' && (
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <label className="font-mono text-[11px] text-white/50 flex items-center gap-2">דק׳ לפני
                              <input type="number" min={0} className={numInputCls} value={cv.beforeMin ?? ''} onChange={e => setCV({ beforeMin: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                            <label className="font-mono text-[11px] text-white/50 flex items-center gap-2">דק׳ אחרי
                              <input type="number" min={0} className={numInputCls} value={cv.afterMin ?? ''} onChange={e => setCV({ afterMin: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                            <span className="font-mono text-[10px] text-white/30">התנאי הזה עדיין נבדק ידנית</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Scope */}
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-white/40 mb-1.5">תחולת החוק</label>
                  <div className="flex gap-2 flex-wrap">
                    {SCOPE_META.map(m => <Pill key={m.key} active={(draft.scope ?? 'always') === m.key} onClick={() => setDraft(d => ({ ...d, scope: m.key }))}>{m.he}</Pill>)}
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-white/40 mb-1.5">סיבת החוק (אופציונלי)</label>
                  <input
                    value={draft.reason ?? ''}
                    onChange={e => setDraft(d => ({ ...d, reason: e.target.value }))}
                    placeholder="למה יצרת את החוק הזה?"
                    className="w-full bg-[#111] border border-[#222] rounded-sm px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-[#d4af37]/40 transition-colors"
                  />
                </div>
              </div>
            )}

            {formError && <p className="font-mono text-[11px] text-[#c98080]">{formError}</p>}

            <div className="flex gap-3">
              <button onClick={saveNewRule} className="px-5 py-2 rounded-sm bg-[#d4af37] text-black font-mono text-xs font-bold uppercase tracking-[0.12em] hover:bg-[#e5c84a] transition-colors">הוסף חוק</button>
              <button onClick={() => { setShowAdd(false); emptyDraftReset(); }} className="px-5 py-2 rounded-sm border border-[#1c1c1e] text-white/40 font-mono text-xs uppercase tracking-[0.12em] hover:text-white/70 transition-colors">ביטול</button>
            </div>
          </div>
        )}

        {/* Rules list grouped by category */}
        {rules.length === 0 && !showAdd ? (
          <div className="py-20 text-center border border-[#1c1c1e] rounded-sm">
            <p className="font-mono text-sm text-white/20">{en ? 'No rules yet' : 'אין חוקים עדיין'}</p>
            <button onClick={() => { emptyDraftReset(); setShowAdd(true); }} className="mt-4 font-mono text-xs text-[#d4af37]/60 hover:text-[#d4af37] transition-colors">
              {en ? '+ Define your first rule' : '+ הגדר את החוק הראשון שלך'}
            </button>
          </div>
        ) : (
          groups.map(g => (
            <div key={g.key}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: g.color }} />
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: g.color + 'cc' }}>{g.label}</span>
              </div>
              <div className="space-y-2">
                {g.rules.map(rule => {
                  const todayCheck = userChecks.find(c => c.ruleId === rule.id && c.date === today);
                  return (
                    <RuleCard
                      key={rule.id}
                      rule={rule}
                      perf={computeRulePerformance(rule, trades, userChecks)}
                      todayReported={todayCheck ? (todayCheck.status === 'unknown' ? null : todayCheck.status) : null}
                      onToggle={() => toggleRule(rule.id)}
                      onDelete={() => setDeleteTarget(rule)}
                      onReport={status => reportToday(rule, status)}
                    />
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title={en ? 'Delete rule?' : 'למחוק חוק?'}
        message={en
          ? <>This will permanently delete the rule <span className="text-white">“{deleteTarget ? ruleTitle(deleteTarget) : ''}”</span>.</>
          : <>החוק <span className="text-white">״{deleteTarget ? ruleTitle(deleteTarget) : ''}״</span> יימחק לצמיתות. אי אפשר לשחזר אותו.</>}
        confirmLabel={en ? 'Delete' : 'מחק'}
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
