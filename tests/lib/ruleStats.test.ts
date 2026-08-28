import { describe, expect, it } from 'vitest';
import { computeRuleStats, computeRuleHistory } from '../../app/lib/rules/stats';
import type { Rule, RuleCheck } from '../../app/lib/rules/types';
import { makeTrade } from '../helpers/trade';

const TODAY = '2026-07-14';
const manualRule = (id: string): Rule => ({ id, title: `r${id}`, category: 'discipline', verificationMode: 'user_report', isActive: true });
const autoRule = (id: string, cv: Rule['conditionValue']): Rule =>
  ({ id, title: `r${id}`, category: 'risk', verificationMode: 'automatic', conditionType: 'allowed_symbols', conditionValue: cv, isActive: true });

/** `at` is when the report was written — the field that decides which of two
    reports for the same (rule, day) is the current one. */
const check = (ruleId: string, date: string, status: 'followed' | 'violated', at = 1_000): RuleCheck =>
  ({ id: `${ruleId}-${date}`, ruleId, date, status, detectedAt: at, updatedAt: at, source: 'user', evidence: '' });

describe('computeRuleStats', () => {
  it('counts manual reports into today / week and leaves unreported rules as no_data', () => {
    const rules = [manualRule('a'), manualRule('b'), manualRule('c')];
    const checks = [check('a', TODAY, 'followed'), check('b', TODAY, 'violated')]; // c never reported
    const s = computeRuleStats(rules, [], checks, TODAY);
    expect(s.today.followed).toBe(1);
    expect(s.today.violated).toBe(1);
    expect(s.today.evaluated).toBe(2);           // c is no_data, excluded
    expect(s.today.rate).toBe(50);
    expect(s.week.evaluated).toBe(2);
  });

  it('derives automatic-rule compliance from the trades on each day', () => {
    const rules = [autoRule('x', { symbols: ['ES'] })];
    const trades = [
      makeTrade({ id: 1, dateISO: TODAY, symbol: 'ES' }),   // followed
      makeTrade({ id: 2, dateISO: TODAY, symbol: 'NQ' }),   // violated → the day is violated
    ];
    const s = computeRuleStats(rules, trades, [], TODAY);
    expect(s.today.violated).toBe(1);
    expect(s.today.followed).toBe(0);
  });

  it('folds day-violations in, and a later report overrides them', () => {
    const rules = [manualRule('a')];
    const violation = [{ ruleId: 'a', date: TODAY, updatedAt: 1_000 }];
    const base = computeRuleStats(rules, [], [], TODAY, violation);
    expect(base.today.violated).toBe(1);
    const overridden = computeRuleStats(rules, [], [check('a', TODAY, 'followed', 2_000)], TODAY, violation);
    expect(overridden.today.followed).toBe(1);
    expect(overridden.today.violated).toBe(0);
  });

  // The ordering used to be by SOURCE: the rules page's checks were applied
  // after the trade form's violations, whatever their order in time. So a
  // "kept" pressed in the morning silently erased a breach the trader recorded
  // against an actual trade that afternoon, and the compliance rate said the
  // rule was kept on a day they had told it otherwise.
  it('does not let an earlier "kept" erase a breach recorded later', () => {
    const rules = [manualRule('a')];
    const morningKept = [check('a', TODAY, 'followed', 1_000)];
    const afternoonBreach = [{ ruleId: 'a', date: TODAY, updatedAt: 2_000 }];
    const s = computeRuleStats(rules, [], morningKept, TODAY, afternoonBreach);
    expect(s.today.violated).toBe(1);
    expect(s.today.followed).toBe(0);
  });

  it('keeps a breach when neither report says when it was written', () => {
    // Rows predating the sync stamp tie at zero, and there is no way to order
    // them. Not hiding a recorded breach is the safer error for a discipline
    // tool than reporting a day as clean that the trader marked otherwise.
    const rules = [manualRule('a')];
    const s = computeRuleStats(rules, [], [check('a', TODAY, 'followed', 0)], TODAY, [{ ruleId: 'a', date: TODAY }]);
    expect(s.today.violated).toBe(1);
  });

  // The trend was the raw difference of two weekly rates, shown with an arrow
  // and a colour. In a week where five rule-days were evaluated, one violation
  // moves the rate twenty points — a direction, in green or red, off a single
  // broken rule.
  it('reports no weekly direction when one rule-day explains the move', () => {
    const rules = [manualRule('a')];
    const checks = [
      // This week: 4 of 5 kept. Last week: 5 of 5. One rule-day apart.
      check('a', TODAY, 'violated'),
      ...['2026-07-13', '2026-07-12', '2026-07-11', '2026-07-10'].map(d => check('a', d, 'followed')),
      ...['2026-07-07', '2026-07-06', '2026-07-05', '2026-07-04', '2026-07-03'].map(d => check('a', d, 'followed')),
    ];
    const s = computeRuleStats(rules, [], checks, TODAY);
    expect(s.week.rate).not.toBe(s.month.rate);
    expect(s.weekTrend).toBeNull();
  });

  it('computes a clean-day streak and a week trend', () => {
    const rules = [manualRule('a')];
    const checks = [
      check('a', TODAY, 'followed'),
      check('a', '2026-07-13', 'followed'),
      check('a', '2026-07-12', 'violated'), // breaks the streak here
    ];
    const s = computeRuleStats(rules, [], checks, TODAY);
    expect(s.streak).toBe(2);
    expect(s.daily).toHaveLength(14);
  });

  it('ignores paused rules and reports null rate when nothing is evaluated', () => {
    const rules = [{ ...manualRule('a'), isActive: false }];
    const s = computeRuleStats(rules, [], [check('a', TODAY, 'violated')], TODAY);
    expect(s.today.evaluated).toBe(0);
    expect(s.today.rate).toBeNull();
    expect(s.topBroken).toHaveLength(0);
  });
});

describe('computeRuleHistory', () => {
  it('reports last kept / last broken, the streak, and recent violations', () => {
    const rule = manualRule('a');
    const checks = [
      check('a', TODAY, 'followed'),
      check('a', '2026-07-13', 'followed'),
      check('a', '2026-07-11', 'violated'),
      check('a', '2026-07-09', 'violated'),
    ];
    const h = computeRuleHistory(rule, [], checks, TODAY);
    expect(h.lastFollowed).toBe(TODAY);
    expect(h.lastViolated).toBe('2026-07-11');
    expect(h.streak).toBe(2); // today + 13th, stopped by the 11th
    expect(h.recentViolations.map(v => v.date)).toEqual(['2026-07-11', '2026-07-09']);
  });

  it('carries the engine evidence for an automatic rule violation', () => {
    const rule = autoRule('x', { symbols: ['ES'] });
    const trades = [makeTrade({ id: 1, dateISO: TODAY, symbol: 'NQ' })];
    const h = computeRuleHistory(rule, trades, [], TODAY);
    expect(h.lastViolated).toBe(TODAY);
    expect(h.recentViolations[0].evidence).toContain('NQ');
    expect(h.streak).toBe(0);
  });

  it('is empty for a rule with no signal at all', () => {
    const h = computeRuleHistory(manualRule('a'), [], [], TODAY);
    expect(h).toEqual({ lastFollowed: null, lastViolated: null, streak: 0, recentViolations: [], violationDates: [] });
  });

  it('collects every violation date within the lookback, not just the 3 shown in recentViolations', () => {
    const rule = manualRule('a');
    const checks = [
      check('a', '2026-07-11', 'violated'),
      check('a', '2026-07-09', 'violated'),
      check('a', '2026-07-06', 'violated'),
      check('a', '2026-07-03', 'violated'),
    ];
    const h = computeRuleHistory(rule, [], checks, TODAY);
    expect(h.recentViolations).toHaveLength(3);
    expect(h.violationDates).toEqual(['2026-07-11', '2026-07-09', '2026-07-06', '2026-07-03']);
  });
});
