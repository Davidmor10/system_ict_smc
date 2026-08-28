import { describe, expect, it } from 'vitest';
import { ruleImpact, ruleConfidence, confidenceLabel, ruleInsight, dashboardRuleInsights } from '../../app/lib/rules/insight';
import type { RulePerformance } from '../../app/lib/rules/performance';
import type { Rule } from '../../app/lib/rules/types';
import { makeTrade } from '../helpers/trade';

const rule = (partial: Partial<Rule> = {}): Rule =>
  ({ id: 'r1', title: 'r1', category: 'risk', isActive: true, ...partial });

/** Builds a minimal RulePerformance fixture — every field has a sane default
    so a test only needs to specify what it actually cares about. */
const perf = (partial: Partial<RulePerformance> = {}): RulePerformance => ({
  followedTrades: 0,
  violatedTrades: 0,
  followedAvgR: null,
  violatedAvgR: null,
  sampleSize: 0,
  confidence: { level: 'low', sampleSize: 0 },
  hasEnough: false,
  // Whether the GAP between the two averages is bigger than one trade could
  // account for — the flag every sentence built on the pair has to read.
  differenceIsReal: false,
  ...partial,
});

describe('ruleImpact', () => {
  it('is "unknown" until the followed/violated comparison clears the sample gate', () => {
    expect(ruleImpact(perf()).level).toBe('unknown');
    expect(ruleImpact(perf({ hasEnough: false, differenceIsReal: false, followedAvgR: 2, violatedAvgR: 0.2 })).level).toBe('unknown');
  });

  it('grades the R delta into high / medium / low', () => {
    expect(ruleImpact(perf({ hasEnough: true, differenceIsReal: true, followedAvgR: 2.0, violatedAvgR: 0.3 })).level).toBe('high');   // delta 1.7
    expect(ruleImpact(perf({ hasEnough: true, differenceIsReal: true, followedAvgR: 1.0, violatedAvgR: 0.3 })).level).toBe('medium'); // delta 0.7
    expect(ruleImpact(perf({ hasEnough: true, differenceIsReal: true, followedAvgR: 0.5, violatedAvgR: 0.4 })).level).toBe('low');    // delta 0.1
  });

  it('never returns "high" impact on a small sample even with a huge delta', () => {
    expect(ruleImpact(perf({ hasEnough: false, differenceIsReal: false, followedAvgR: 3, violatedAvgR: -1 })).level).toBe('unknown');
  });

  it('carries the exact Hebrew labels the Rules page expects', () => {
    expect(ruleImpact(perf()).label).toBe('לא ידוע');
    expect(ruleImpact(perf({ hasEnough: true, differenceIsReal: true, followedAvgR: 2.0, violatedAvgR: 0.3 })).label).toBe('השפעה גבוהה');
  });
});

describe('ruleConfidence', () => {
  it('is "none" with a null percent when the rule was never observed', () => {
    const c = ruleConfidence(perf({ followedTrades: 0, violatedTrades: 0 }));
    expect(c.level).toBe('none');
    expect(c.percent).toBeNull();
    expect(confidenceLabel(c)).toBe('—');
  });

  it('grades level by total observations: <15 low, 15-39 medium, 40+ high', () => {
    expect(ruleConfidence(perf({ followedTrades: 5, violatedTrades: 4 })).level).toBe('low');    // total 9
    expect(ruleConfidence(perf({ followedTrades: 10, violatedTrades: 5 })).level).toBe('medium'); // total 15
    expect(ruleConfidence(perf({ followedTrades: 30, violatedTrades: 10 })).level).toBe('high');  // total 40
  });

  it('percent is monotonically increasing with sample size and never reaches the 97% cap', () => {
    const low = ruleConfidence(perf({ followedTrades: 1, violatedTrades: 0 })).percent!;
    const med = ruleConfidence(perf({ followedTrades: 10, violatedTrades: 5 })).percent!;
    const high = ruleConfidence(perf({ followedTrades: 300, violatedTrades: 200 })).percent!;
    expect(low).toBeLessThan(med);
    expect(med).toBeLessThan(high);
    expect(high).toBeLessThan(97);
  });

  it('formats the label as "level · percent%"', () => {
    const c = ruleConfidence(perf({ followedTrades: 30, violatedTrades: 10 }));
    expect(confidenceLabel(c)).toMatch(/^ביטחון גבוה · \d+%$/);
  });
});

describe('ruleInsight', () => {
  it('flags a fallback when there is not enough of any signal', () => {
    const r = ruleInsight(rule(), perf(), [], []);
    expect(r.basis).toBe('insufficient');
  });

  // It used to fire on three violations where two followed a loss, and then
  // explain the mechanism: "the loss probably shakes your discipline". Two of
  // three is what a coin does, and no number here can show what shook anyone.
  it('says nothing about losses when the clustering is what any day would do', () => {
    // Half the days follow a loss, and so do half the violations. Nothing.
    const trades = ['01', '02', '03', '04', '05', '06', '07', '08'].map((d, i) =>
      makeTrade({ id: i + 1, dateISO: `2026-07-${d}`, time: '10:00', result: i % 2 === 0 ? 'LOSS' : 'WIN' }));
    const violationDates = ['2026-07-02', '2026-07-04', '2026-07-06', '2026-07-08', '2026-07-03'];
    const r = ruleInsight(rule(), perf(), violationDates, trades);
    expect(r.basis).not.toBe('after_loss');
  });

  it('names the clustering when it is far enough from what other days do', () => {
    // Twenty days: the ten that follow a loss carry nine of the ten breaches.
    const trades = Array.from({ length: 20 }, (_, i) =>
      makeTrade({
        id: i + 1,
        dateISO: `2026-07-${String(i + 1).padStart(2, '0')}`,
        time: '10:00',
        result: i % 2 === 0 ? 'LOSS' : 'WIN',
      }));
    // Days 2,4,…,20 are the ones preceded by a loss.
    const afterLossDays = Array.from({ length: 10 }, (_, i) => `2026-07-${String((i + 1) * 2).padStart(2, '0')}`);
    const violationDates = [...afterLossDays.slice(0, 9), '2026-07-03'];
    const r = ruleInsight(rule(), perf(), violationDates, trades);
    expect(r.basis).toBe('after_loss');
    // States the association and the counts behind it, and explains nothing.
    expect(r.text).toContain('9');
    expect(r.text).not.toContain('משמעת');
  });

  it('needs more than a handful of breaches before it looks at all', () => {
    const trades = Array.from({ length: 8 }, (_, i) =>
      makeTrade({ id: i + 1, dateISO: `2026-07-0${i + 1}`, time: '10:00', result: 'LOSS' }));
    const r = ruleInsight(rule(), perf(), ['2026-07-02', '2026-07-04', '2026-07-06'], trades);
    expect(r.basis).not.toBe('after_loss');
  });

  it('reports the two averages, and never that keeping the rule improves them', () => {
    const p = perf({ hasEnough: true, differenceIsReal: true, followedAvgR: 2.2, violatedAvgR: 0.1, followedTrades: 8, violatedTrades: 8, sampleSize: 16 });
    const r = ruleInsight(rule(), p, [], []);
    expect(r.basis).toBe('delta');
    expect(r.text).toContain('2.2');
    expect(r.text).toContain('0.1');
    expect(r.text).toContain('16');
    // "improves" is a cause. The journal measured two averages.
    expect(r.text).not.toContain('משפרת');
  });

  it('says nothing about the gap when one trade could account for it', () => {
    const p = perf({ hasEnough: true, differenceIsReal: false, followedAvgR: 2.2, violatedAvgR: 0.1, followedTrades: 8, violatedTrades: 8 });
    expect(ruleInsight(rule(), p, [], []).basis).not.toBe('delta');
  });

  it('names high adherence as a strong habit when there is no strong delta signal', () => {
    const p = perf({ followedTrades: 19, violatedTrades: 1, hasEnough: false });
    const r = ruleInsight(rule(), p, [], []);
    expect(r.basis).toBe('adherence');
  });
});

describe('dashboardRuleInsights', () => {
  const catLabel = (c: string) => (c === 'risk' ? 'ניהול סיכון' : c === 'discipline' ? 'משמעת' : c);

  it('returns nothing when no rule has any data yet', () => {
    const rules = [rule({ id: 'a' }), rule({ id: 'b' })];
    const map = new Map([['a', perf()], ['b', perf()]] as [string, RulePerformance][]);
    expect(dashboardRuleInsights(rules, map, catLabel)).toEqual([]);
  });

  it('names the strongest category once it clears the sample gate and a high rate', () => {
    const rules = [rule({ id: 'a', category: 'discipline' })];
    const map = new Map([['a', perf({ followedTrades: 9, violatedTrades: 1 })]] as [string, RulePerformance][]);
    const insights = dashboardRuleInsights(rules, map, catLabel);
    expect(insights.some(t => t.includes('משמעת') && t.includes('90%'))).toBe(true);
  });

  it('does not name a category "strongest" on too small a sample even at 100%', () => {
    const rules = [rule({ id: 'a', category: 'discipline' })];
    const map = new Map([['a', perf({ followedTrades: 2, violatedTrades: 0 })]] as [string, RulePerformance][]);
    expect(dashboardRuleInsights(rules, map, catLabel)).toEqual([]);
  });

  it('caps the result at 3 sentences', () => {
    const rules = [
      rule({ id: 'a', category: 'discipline', title: 'A' }),
      rule({ id: 'b', category: 'risk', title: 'B' }),
    ];
    const map = new Map([
      ['a', perf({ followedTrades: 9, violatedTrades: 1, hasEnough: true, followedAvgR: 2, violatedAvgR: 0 })],
      ['b', perf({ followedTrades: 1, violatedTrades: 9 })],
    ] as [string, RulePerformance][]);
    const insights = dashboardRuleInsights(rules, map, catLabel);
    expect(insights.length).toBeLessThanOrEqual(3);
  });
});
