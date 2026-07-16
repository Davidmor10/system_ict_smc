import { describe, expect, it } from 'vitest';
import { computeRuleStats, computeRuleHistory } from '../../app/lib/rules/stats';
import type { Rule, RuleCheck } from '../../app/lib/rules/types';
import { makeTrade } from '../helpers/trade';

const TODAY = '2026-07-14';
const manualRule = (id: string): Rule => ({ id, title: `r${id}`, category: 'discipline', verificationMode: 'user_report', isActive: true });
const autoRule = (id: string, cv: Rule['conditionValue']): Rule =>
  ({ id, title: `r${id}`, category: 'risk', verificationMode: 'automatic', conditionType: 'allowed_symbols', conditionValue: cv, isActive: true });

const check = (ruleId: string, date: string, status: 'followed' | 'violated'): RuleCheck =>
  ({ id: `${ruleId}-${date}`, ruleId, date, status, detectedAt: 0, source: 'user', evidence: '' });

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

  it('folds legacy day-violations in, and newer user checks override them', () => {
    const rules = [manualRule('a')];
    const legacy = [{ ruleId: 'a', date: TODAY }];
    const base = computeRuleStats(rules, [], [], TODAY, legacy);
    expect(base.today.violated).toBe(1);
    const overridden = computeRuleStats(rules, [], [check('a', TODAY, 'followed')], TODAY, legacy);
    expect(overridden.today.followed).toBe(1);
    expect(overridden.today.violated).toBe(0);
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
