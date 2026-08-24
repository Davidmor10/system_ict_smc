// ─────────────────────────────────────────────────────────────────────────────
// Which rule, not how many.
//
// The trade form has asked "which rules did you break" for weeks, and stored
// the answer, and nothing read it: the behaviour layer knows only that a rule
// was broken. A coach working from one bit can only repeat itself, which is
// why "you deviated from your rules" was the same sentence every time.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { rankRuleBreaches, __internals } from '../../app/lib/coach-pipeline/analyzers/rulesBroken';

const TODAY = '2026-08-24';
const rules = new Map([
  ['r1', 'לחכות לאישור לפני כניסה'],
  ['r2', 'לא להיכנס בחצי השעה הראשונה'],
]);
const at = (daysAgo: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};
const breach = (ruleId: string, daysAgo: number) => ({ ruleId, date: at(daysAgo) });

describe('rankRuleBreaches', () => {
  it('names the rule in the trader\'s own words, and counts it', () => {
    const out = rankRuleBreaches(rules, [breach('r1', 1), breach('r1', 4), breach('r2', 2)], TODAY);
    expect(out[0]).toEqual({ rule: 'לחכות לאישור לפני כניסה', count: 2, lastDate: at(1) });
    expect(out[1].rule).toBe('לא להיכנס בחצי השעה הראשונה');
  });

  it('carries the last date, so a standing problem reads differently from an old one', () => {
    const [only] = rankRuleBreaches(rules, [breach('r2', 30), breach('r2', 25)], TODAY);
    expect(only.lastDate).toBe(at(25));
  });

  it('drops anything older than the window — last winter is not a habit', () => {
    const old = __internals.WINDOW_DAYS + 5;
    expect(rankRuleBreaches(rules, [breach('r1', old)], TODAY)).toEqual([]);
  });

  it('drops a breach whose rule the trader has since deleted', () => {
    // Showing it would print a database key at someone who cannot act on it.
    expect(rankRuleBreaches(rules, [breach('gone', 2)], TODAY)).toEqual([]);
  });

  it('ignores a date in the future rather than ranking it first', () => {
    expect(rankRuleBreaches(rules, [breach('r1', -3)], TODAY)).toEqual([]);
  });

  it('keeps the list short enough to stay a sentence', () => {
    const many = new Map(Array.from({ length: 9 }, (_, i) => [`r${i}`, `חוק ${i}`]));
    const all = Array.from({ length: 9 }, (_, i) => breach(`r${i}`, 1));
    expect(rankRuleBreaches(many, all, TODAY).length).toBeLessThanOrEqual(__internals.MAX_RULES);
  });

  it('says nothing when the trader has ticked nothing', () => {
    expect(rankRuleBreaches(rules, [], TODAY)).toEqual([]);
  });
});
