import { describe, expect, it } from 'vitest';
import { discoverPatterns } from '../../app/lib/analytics/patterns';
import { makeTrade } from '../helpers/trade';

describe('discoverPatterns — bias alignment / setup / weekday dimensions', () => {
  it('surfaces a bias-alignment candidate when aligned trades clearly outperform', () => {
    const trades = [
      ...Array.from({ length: 5 }, () => makeTrade({ biasAlignment: 'ALIGNED', result: 'WIN' })),
      ...Array.from({ length: 5 }, () => makeTrade({ biasAlignment: 'COUNTER', result: 'LOSS' })),
    ];
    const candidates = discoverPatterns(trades);
    const aligned = candidates.find(c => c.kind === 'bias_alignment' && c.subject.biasAlignment === 'ALIGNED');
    expect(aligned).toBeDefined();
    expect(aligned!.metric.winRate).toBe(100);
    expect(aligned!.metric.trades).toBe(5);
  });

  it('surfaces a setup candidate (reversal vs continuation)', () => {
    const trades = [
      ...Array.from({ length: 4 }, () => makeTrade({ setup: 'REVERSAL', result: 'WIN' })),
      ...Array.from({ length: 4 }, () => makeTrade({ setup: 'CONTINUATION', result: 'LOSS' })),
    ];
    const candidates = discoverPatterns(trades);
    const reversal = candidates.find(c => c.kind === 'setup' && c.subject.setup === 'REVERSAL');
    const continuation = candidates.find(c => c.kind === 'setup' && c.subject.setup === 'CONTINUATION');
    expect(reversal?.metric.winRate).toBe(100);
    expect(continuation?.metric.winRate).toBe(0);
  });

  it('surfaces a weekday candidate for a day with enough trades', () => {
    // 2026-07-14 is a Tuesday.
    const trades = Array.from({ length: 4 }, () => makeTrade({ dateISO: '2026-07-14', result: 'WIN' }));
    const candidates = discoverPatterns(trades);
    const tuesday = candidates.find(c => c.kind === 'weekday');
    expect(tuesday).toBeDefined();
    expect(tuesday!.subject.weekday).toBe(2); // Sunday=0 .. Tuesday=2
    expect(tuesday!.metric.trades).toBe(4);
  });

  it('does not surface a bias/setup/weekday candidate below the 3-trade floor', () => {
    const trades = [
      makeTrade({ biasAlignment: 'ALIGNED', setup: 'REVERSAL', dateISO: '2026-07-14' }),
      makeTrade({ biasAlignment: 'ALIGNED', setup: 'REVERSAL', dateISO: '2026-07-14' }),
    ];
    const candidates = discoverPatterns(trades);
    expect(candidates.some(c => c.kind === 'bias_alignment')).toBe(false);
    expect(candidates.some(c => c.kind === 'setup')).toBe(false);
    expect(candidates.some(c => c.kind === 'weekday')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Significance
//
// discoverPatterns deliberately slices the same trades a hundred different
// ways. That is the right way to FIND a candidate and a catastrophic way to
// confirm one: at a hundred comparisons, several slices clear any win-rate gap
// you care to name by chance alone — for every trader, every run, including a
// trader entering at random.
//
// The first test is the one that matters. It feeds in a history with no edge
// in it whatsoever and asserts the system says so. Before the correction, that
// same history produced slices at 100% and 0% and handed the best of them to
// the dashboard as "what actually works for you".
// ═══════════════════════════════════════════════════════════════════════════

const SYMBOLS = ['ES', 'NQ', 'MES', 'MNQ'] as const;
const SESSIONS = ['asia', 'london', 'nyam', 'nypm'];

/** A history with no edge: results alternate on a fixed cycle that shares no
 *  factor with the number of instruments, sessions or hours, so no slice is
 *  systematically better than another. Deterministic — a seeded random would
 *  make this test flaky, and a flaky statistics test is worse than none. */
function noEdgeHistory(n: number) {
  return Array.from({ length: n }, (_, i) => makeTrade({
    symbol:  SYMBOLS[i % 4],
    session: SESSIONS[(i + 1) % 4],
    time:    `${String(9 + (i % 7)).padStart(2, '0')}:30`,
    direction: i % 2 === 0 ? 'LONG' : 'SHORT',
    result:  i % 3 === 0 ? 'LOSS' : 'WIN',
  }));
}

describe('discoverPatterns — the multiple-comparisons correction', () => {
  it('finds nothing significant in a history that contains nothing', () => {
    const candidates = discoverPatterns(noEdgeHistory(60));
    expect(candidates.length).toBeGreaterThan(20);          // it did slice widely
    expect(candidates.filter(c => c.significant)).toEqual([]); // and believed none of it
  });

  it('still finds a real edge that is large enough to survive the correction', () => {
    // Every london trade wins, every nypm trade loses. Nothing subtle.
    const trades = [
      ...Array.from({ length: 14 }, () => makeTrade({ session: 'london', result: 'WIN' })),
      ...Array.from({ length: 14 }, () => makeTrade({ session: 'nypm',   result: 'LOSS' })),
    ];
    const candidates = discoverPatterns(trades);
    const significant = candidates.filter(c => c.significant);
    expect(significant.length).toBeGreaterThan(0);
    expect(significant.some(c => c.subject.session === 'london')).toBe(true);
  });

  it('ranks the survivors above everything else', () => {
    const trades = [
      ...Array.from({ length: 14 }, () => makeTrade({ session: 'london', result: 'WIN' })),
      ...Array.from({ length: 14 }, () => makeTrade({ session: 'nypm',   result: 'LOSS' })),
    ];
    const candidates = discoverPatterns(trades);
    expect(candidates[0].significant).toBe(true);
  });

  it('will not call a four-trade slice significant however clean it looks', () => {
    const trades = [
      ...Array.from({ length: 4 },  () => makeTrade({ symbol: 'ES', result: 'WIN'  })),
      ...Array.from({ length: 20 }, () => makeTrade({ symbol: 'NQ', result: 'LOSS' })),
    ];
    const es = discoverPatterns(trades).find(c => c.id === 'inst_ES');
    expect(es).toBeDefined();
    expect(es!.metric.winRate).toBe(100);
    expect(es!.significant).toBe(false);   // 4 decided trades is below the floor
  });

  it('tests each slice against the trades outside it, not against a pool containing it', () => {
    // Half the history wins, half loses, split by session. If the slice were
    // compared against an overall rate that includes itself, the gap would be
    // halved and the p-value inflated.
    const trades = [
      ...Array.from({ length: 12 }, () => makeTrade({ session: 'london', result: 'WIN' })),
      ...Array.from({ length: 12 }, () => makeTrade({ session: 'nypm',   result: 'LOSS' })),
    ];
    const london = discoverPatterns(trades).find(c => c.subject.session === 'london' && c.kind === 'session_vs_overall');
    expect(london).toBeDefined();
    expect(london!.pValue).toBeLessThan(1e-5);
  });
});
