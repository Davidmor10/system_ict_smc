import { describe, expect, it } from 'vitest';
import { checkRule, AUTO_SUPPORTED } from '../../app/lib/rules/engine';
import { computeRulePerformance } from '../../app/lib/rules/performance';
import { upsertCheck, type Rule, type RuleCheck } from '../../app/lib/rules/types';
import { makeTrade } from '../helpers/trade';

const autoRule = (partial: Partial<Rule>): Rule =>
  ({ id: 'r1', title: 't', category: 'risk', verificationMode: 'automatic', isActive: true, ...partial });

describe('rule engine — followed / violated', () => {
  it('max_trades_per_day flags the trade past the cap', () => {
    const rule = autoRule({ conditionType: 'max_trades_per_day', conditionValue: { max: 2 } });
    const day = [makeTrade({ id: 1, time: '09:00' }), makeTrade({ id: 2, time: '10:00' }), makeTrade({ id: 3, time: '11:00' })];
    expect(checkRule(rule, day[2], day).status).toBe('violated'); // 3rd trade
    expect(checkRule(rule, day[1], day).status).toBe('followed'); // 2nd trade
  });

  it('stop_after_losses flags a trade taken after the loss cap', () => {
    const rule = autoRule({ conditionType: 'stop_after_losses', conditionValue: { losses: 2 } });
    const day = [
      makeTrade({ id: 1, time: '09:00', result: 'LOSS' }),
      makeTrade({ id: 2, time: '10:00', result: 'LOSS' }),
      makeTrade({ id: 3, time: '11:00', result: 'WIN' }),
    ];
    expect(checkRule(rule, day[2], day).status).toBe('violated');
    expect(checkRule(rule, day[1], day).status).toBe('followed');
  });

  it('allowed_hours judges by entry time', () => {
    const rule = autoRule({ conditionType: 'allowed_hours', conditionValue: { startMin: 9 * 60, endMin: 12 * 60 } });
    expect(checkRule(rule, makeTrade({ time: '09:30' }), []).status).toBe('followed');
    expect(checkRule(rule, makeTrade({ time: '13:00' }), []).status).toBe('violated');
  });

  it('allowed_symbols and required_confirmations', () => {
    const sym = autoRule({ conditionType: 'allowed_symbols', conditionValue: { symbols: ['ES'] } });
    expect(checkRule(sym, makeTrade({ symbol: 'ES' }), []).status).toBe('followed');
    expect(checkRule(sym, makeTrade({ symbol: 'NQ' }), []).status).toBe('violated');

    const conf = autoRule({ conditionType: 'required_confirmations', conditionValue: { tags: ['SMT'] } });
    expect(checkRule(conf, makeTrade({ confirmations: ['SMT'] }), []).status).toBe('followed');
    expect(checkRule(conf, makeTrade({ confirmations: ['IFVG'] }), []).status).toBe('violated');
  });
});

describe('rule engine — unknown when data is missing (never guess violated)', () => {
  it('user_report rules and unsupported conditions are unknown', () => {
    const manual: Rule = { id: 'r', title: 't', category: 'discipline', verificationMode: 'user_report', isActive: true };
    expect(checkRule(manual, makeTrade({}), [makeTrade({})]).status).toBe('unknown');

    const news = autoRule({ conditionType: 'no_trade_around_news', conditionValue: { beforeMin: 10, afterMin: 10 } });
    expect(checkRule(news, makeTrade({}), [makeTrade({})]).status).toBe('unknown'); // no macro events supplied
  });

  it('missing trade data yields unknown, not violated', () => {
    const risk = autoRule({ conditionType: 'max_risk_per_trade', conditionValue: { maxUsd: 100 } });
    expect(checkRule(risk, makeTrade({ stop: 0 }), []).status).toBe('unknown'); // no stop → can't compute risk

    const sess = autoRule({ conditionType: 'allowed_sessions', conditionValue: { sessions: ['london'] } });
    expect(checkRule(sess, makeTrade({ session: 'NONE' }), []).status).toBe('unknown');

    const conf = autoRule({ conditionType: 'required_confirmations', conditionValue: { tags: ['SMT'] } });
    expect(checkRule(conf, makeTrade({ confirmations: undefined }), []).status).toBe('unknown'); // confirmations never recorded

    const hours = autoRule({ conditionType: 'allowed_hours', conditionValue: { startMin: 540, endMin: 720 } });
    expect(checkRule(hours, makeTrade({ time: '' }), []).status).toBe('unknown');
  });

  it('a condition with no configured value is unknown', () => {
    const rule = autoRule({ conditionType: 'max_trades_per_day', conditionValue: {} });
    expect(checkRule(rule, makeTrade({}), [makeTrade({})]).status).toBe('unknown');
  });

  it('AUTO_SUPPORTED lists the auto-checkable conditions, excludes news', () => {
    expect(AUTO_SUPPORTED).toContain('max_trades_per_day');
    expect(AUTO_SUPPORTED).toContain('required_confirmations');
    expect(AUTO_SUPPORTED).not.toContain('no_trade_around_news');
  });
});

describe('manual check dedup (upsertCheck)', () => {
  it('replaces an earlier report for the same rule + same event', () => {
    let checks: RuleCheck[] = [];
    checks = upsertCheck(checks, { id: 'a', ruleId: 'r1', date: '2026-07-06', status: 'violated', detectedAt: 1, source: 'user', evidence: '' });
    checks = upsertCheck(checks, { id: 'b', ruleId: 'r1', date: '2026-07-06', status: 'followed', detectedAt: 2, source: 'user', evidence: '' });
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe('followed');

    checks = upsertCheck(checks, { id: 'c', ruleId: 'r1', date: '2026-07-07', status: 'violated', detectedAt: 3, source: 'user', evidence: '' });
    expect(checks).toHaveLength(2); // different day → distinct event
  });
});

describe('per-rule performance', () => {
  const rule = autoRule({ conditionType: 'allowed_symbols', conditionValue: { symbols: ['ES'] } });

  it('compares followed vs violated once both sides have enough decided trades', () => {
    const trades = [
      ...Array.from({ length: 3 }, (_, i) => makeTrade({ id: 100 + i, symbol: 'ES', result: 'WIN', tradeR: 2 })),
      ...Array.from({ length: 3 }, (_, i) => makeTrade({ id: 200 + i, symbol: 'NQ', result: 'LOSS', tradeR: -1 })),
    ];
    const perf = computeRulePerformance(rule, trades);
    expect(perf.hasEnough).toBe(true);
    expect(perf.sampleSize).toBe(6);
    expect(perf.followedAvgR).toBeCloseTo(2);
    expect(perf.violatedAvgR).toBeCloseTo(-1);
  });

  it('withholds the comparison when the sample is too small', () => {
    const perf = computeRulePerformance(rule, [
      makeTrade({ symbol: 'ES', result: 'WIN', tradeR: 2 }),
      makeTrade({ symbol: 'NQ', result: 'LOSS', tradeR: -1 }),
    ]);
    expect(perf.hasEnough).toBe(false);
  });
});
