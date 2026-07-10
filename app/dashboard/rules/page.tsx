'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../../hooks/useLanguage';
import { loadTrades, todayISO } from '../../lib/journal';
import { hydrateList, commitList } from '../../lib/sync/collections';

const STORAGE_KEY = 'onyx_trading_rules';
const VIOLATIONS_KEY = 'onyx_rule_violations';

interface Rule { id: string; text: string; category: 'discipline' | 'entry' | 'exit' | 'risk'; isActive: boolean; updatedAt?: number; deleted?: boolean; }
interface Violation { id: string; ruleId: string; date: string; tradeNote?: string; updatedAt?: number; deleted?: boolean; }

function ensureVioIds(list: unknown): Violation[] {
  if (!Array.isArray(list)) return [];
  return list.map((v, i) => (v?.id ? v : { ...v, id: `${v?.ruleId ?? 'v'}-${v?.date ?? ''}-${i}-${Math.random().toString(36).slice(2, 8)}` })) as Violation[];
}

const CATEGORIES: Rule['category'][] = ['discipline', 'entry', 'exit', 'risk'];
const CATEGORY_COLORS: Record<Rule['category'], string> = {
  discipline: '#d4af37',
  entry: '#3b82f6',
  exit: '#22c55e',
  risk: '#ef4444',
};

function RuleCard({ rule, violations, onToggle, onDelete, onViolate }: {
  rule: Rule;
  violations: Violation[];
  onToggle: () => void;
  onDelete: () => void;
  onViolate: () => void;
}) {
  const today = todayISO();
  const todayViolations = violations.filter(v => v.ruleId === rule.id && v.date === today).length;
  const totalViolations = violations.filter(v => v.ruleId === rule.id).length;

  const recentDays = 7;
  const recentViolations = violations.filter(v => {
    if (v.ruleId !== rule.id) return false;
    const d = new Date(v.date);
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - recentDays);
    return d >= cutoff;
  }).length;

  const streak = (() => {
    let count = 0;
    const d = new Date();
    while (count < 30) {
      const iso = d.toISOString().slice(0, 10);
      if (violations.some(v => v.ruleId === rule.id && v.date === iso)) break;
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  })();

  return (
    <div className={`border rounded-sm p-4 transition-opacity ${rule.isActive ? 'border-[#1c1c1e] bg-[#0a0a0b]' : 'border-[#111] bg-[#070708] opacity-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
            style={{ background: CATEGORY_COLORS[rule.category] }}
          />
          <div className="min-w-0">
            <p className={`font-mono text-sm ${rule.isActive ? 'text-white/80' : 'text-white/40'}`} dir="rtl">{rule.text}</p>
            <span className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: CATEGORY_COLORS[rule.category] + '80' }}>
              {rule.category}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onToggle}
            className={`font-mono text-[9px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-sm border transition-colors ${rule.isActive ? 'border-[#22c55e]/30 text-[#22c55e]/70 hover:border-[#ef4444]/30 hover:text-[#ef4444]/70' : 'border-[#333] text-white/30 hover:text-white/60'}`}
          >
            {rule.isActive ? 'ON' : 'OFF'}
          </button>
          <button onClick={onDelete} className="font-mono text-[10px] text-white/20 hover:text-[#ef4444] transition-colors">✕</button>
        </div>
      </div>

      {rule.isActive && (
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[#111] flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">Streak</span>
            <span className={`font-mono text-sm font-bold ${streak >= 7 ? 'text-[#22c55e]' : streak >= 3 ? 'text-[#d4af37]' : 'text-white/50'}`}>{streak}d</span>
            {streak >= 7 && <span className="text-[10px]">🔥</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">7d violations</span>
            <span className={`font-mono text-sm font-bold ${recentViolations === 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>{recentViolations}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">Today</span>
            <span className={`font-mono text-sm font-bold ${todayViolations === 0 ? 'text-white/30' : 'text-[#ef4444]'}`}>{todayViolations}</span>
          </div>
          {todayViolations === 0 && (
            <button
              onClick={onViolate}
              className="ml-auto font-mono text-[9px] uppercase tracking-[0.14em] px-2.5 py-1 border border-[#ef4444]/20 text-[#ef4444]/50 hover:border-[#ef4444]/50 hover:text-[#ef4444]/80 rounded-sm transition-colors"
            >
              Log Violation
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function RulesPage() {
  const { lang } = useLanguage();
  const en = lang === 'en';
  const [rules, setRules] = useState<Rule[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState<Rule['category']>('discipline');
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    // Instant paint from cache, then cloud reconcile (cross-device).
    const r = localStorage.getItem(STORAGE_KEY);
    if (r) try { setRules((JSON.parse(r) as Rule[]).filter(x => !x.deleted)); } catch { /* ignore */ }
    // Legacy violations had no id — migrate before hydrating so the merge can
    // dedupe them (multiple same-rule/day violations must survive as distinct).
    const v = localStorage.getItem(VIOLATIONS_KEY);
    if (v) try {
      const migrated = ensureVioIds(JSON.parse(v));
      localStorage.setItem(VIOLATIONS_KEY, JSON.stringify(migrated));
      setViolations(migrated.filter(x => !x.deleted));
    } catch { /* ignore */ }

    hydrateList<Rule>('rules', STORAGE_KEY).then(setRules).catch(() => {});
    hydrateList<Violation>('violations', VIOLATIONS_KEY).then(setViolations).catch(() => {});
  }, []);

  function persistRules(updated: Rule[]) {
    setRules(updated);
    void commitList<Rule>('rules', STORAGE_KEY, updated);
  }

  function persistViolations(updated: Violation[]) {
    setViolations(updated);
    void commitList<Violation>('violations', VIOLATIONS_KEY, updated);
  }

  function addRule() {
    if (!newText.trim()) return;
    persistRules([...rules, { id: Date.now().toString(), text: newText.trim(), category: newCategory, isActive: true }]);
    setNewText('');
    setShowAdd(false);
  }

  function toggleRule(id: string) {
    persistRules(rules.map(r => r.id === id ? { ...r, isActive: !r.isActive } : r));
  }

  function deleteRule(id: string) {
    persistRules(rules.filter(r => r.id !== id));
    persistViolations(violations.filter(v => v.ruleId !== id));
  }

  function logViolation(ruleId: string) {
    persistViolations([...violations, { id: `${ruleId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ruleId, date: todayISO() }]);
  }

  const today = todayISO();
  const todayViolationCount = violations.filter(v => v.date === today).length;
  const activeRules = rules.filter(r => r.isActive);
  const complianceToday = activeRules.length > 0
    ? Math.round(((activeRules.length - todayViolationCount) / activeRules.length) * 100)
    : 100;

  const grouped = CATEGORIES.map(cat => ({ cat, rules: rules.filter(r => r.category === cat) })).filter(g => g.rules.length > 0);

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
              onClick={() => setShowAdd(true)}
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
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-2">Today's Discipline</p>
              <p className="font-serif text-3xl font-bold" style={{ color: complianceToday >= 80 ? '#22c55e' : complianceToday >= 60 ? '#d4af37' : '#ef4444' }}>
                {complianceToday}%
              </p>
              <p className="font-mono text-[10px] text-white/30 mt-1">{todayViolationCount} violations today</p>
            </div>
            <div className="flex-1 min-w-[140px] px-5 py-4 border border-[#1c1c1e] rounded-sm bg-[#0a0a0b]">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-2">Active Rules</p>
              <p className="font-serif text-3xl font-bold text-white">{activeRules.length}</p>
              <p className="font-mono text-[10px] text-white/30 mt-1">{rules.length - activeRules.length} paused</p>
            </div>
          </div>
        )}

        {/* Add rule form */}
        {showAdd && (
          <div className="border border-[#d4af37]/20 rounded-sm bg-[#0a0a0b] p-5 space-y-4">
            <textarea
              value={newText}
              onChange={e => setNewText(e.target.value)}
              placeholder="e.g. לא לסחור בשעה הראשונה אחרי הפתיחה"
              className="w-full bg-[#111] border border-[#222] rounded-sm px-3 py-2 font-mono text-sm text-white placeholder-white/20 outline-none focus:border-[#d4af37]/40 transition-colors resize-none"
              rows={2}
              dir="rtl"
            />
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setNewCategory(cat)}
                  className={`px-3 py-1 rounded-sm font-mono text-[10px] uppercase tracking-[0.14em] border transition-colors`}
                  style={{
                    borderColor: newCategory === cat ? CATEGORY_COLORS[cat] + '60' : '#222',
                    color: newCategory === cat ? CATEGORY_COLORS[cat] : 'rgba(255,255,255,0.3)',
                    background: newCategory === cat ? CATEGORY_COLORS[cat] + '10' : 'transparent',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={addRule} className="px-5 py-2 rounded-sm bg-[#d4af37] text-black font-mono text-xs font-bold uppercase tracking-[0.12em] hover:bg-[#e5c84a] transition-colors">
                {en ? 'Add Rule' : 'הוסף חוק'}
              </button>
              <button onClick={() => setShowAdd(false)} className="px-5 py-2 rounded-sm border border-[#1c1c1e] text-white/40 font-mono text-xs uppercase tracking-[0.12em] hover:text-white/70 transition-colors">
                {en ? 'Cancel' : 'ביטול'}
              </button>
            </div>
          </div>
        )}

        {/* Rules list grouped by category */}
        {rules.length === 0 && !showAdd ? (
          <div className="py-20 text-center border border-[#1c1c1e] rounded-sm">
            <p className="font-mono text-sm text-white/20">{en ? 'No rules yet' : 'אין חוקים עדיין'}</p>
            <button onClick={() => setShowAdd(true)} className="mt-4 font-mono text-xs text-[#d4af37]/60 hover:text-[#d4af37] transition-colors">
              {en ? '+ Define your first rule' : '+ הגדר את החוק הראשון שלך'}
            </button>
          </div>
        ) : (
          grouped.map(({ cat, rules: catRules }) => (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_COLORS[cat] }} />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: CATEGORY_COLORS[cat] + '80' }}>{cat}</span>
              </div>
              <div className="space-y-2">
                {catRules.map(rule => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    violations={violations}
                    onToggle={() => toggleRule(rule.id)}
                    onDelete={() => deleteRule(rule.id)}
                    onViolate={() => logViolation(rule.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
