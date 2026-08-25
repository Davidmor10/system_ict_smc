// Recovering a real macro history from the cache the app already keeps.
//
// The failure this guards against is not a crash. It is a day the feed never
// covered being counted as a day on which nothing happened — which would drop
// FOMC afternoons into the control group and flatten the very difference the
// comparison exists to find. Every test below is really about that one line.

import { describe, it, expect } from 'vitest';
import { buildMacroContext, EMPTY_MACRO_CONTEXT } from '../../app/lib/analytics/macroHistory';
import { discoverPatterns } from '../../app/lib/analytics/patterns';
import type { MacroEvent } from '../../app/lib/ai/macroCalendar';
import type { TradeEntry } from '../../app/lib/journal';

const ev = (over: Partial<MacroEvent>): MacroEvent => ({
  title: 'Some Index',
  currency: 'USD',
  impact: 'Low',
  dateIsrael: '2026-08-10',
  timeIsrael: '15:30',
  ...over,
});

const trade = (over: Partial<TradeEntry>): TradeEntry => ({
  id: 1_700_000_000_000,
  dateISO: '2026-08-10',
  time: '17:00',
  symbol: 'MNQ',
  direction: 'LONG',
  session: 'NY_AM',
  entry: 100,
  stop: 95,
  target: 115,
  result: 'WIN',
  pnlUsd: 100,
  contracts: 1,
  bias: 'BULLISH',
  model: '',
  notes: '',
  ...(over as object),
} as TradeEntry);

describe('buildMacroContext', () => {
  it('marks a day as an event day only for high-impact USD releases', () => {
    const ctx = buildMacroContext([[
      ev({ dateIsrael: '2026-08-10', impact: 'High', currency: 'USD', title: 'CPI m/m' }),
      ev({ dateIsrael: '2026-08-11', impact: 'Low',  currency: 'USD' }),
      ev({ dateIsrael: '2026-08-12', impact: 'High', currency: 'EUR' }),
    ]]);
    expect([...ctx.eventDays]).toEqual(['2026-08-10']);
  });

  it('counts a bank holiday as an event day', () => {
    const ctx = buildMacroContext([[ev({ dateIsrael: '2026-07-03', impact: 'Holiday' })]]);
    expect(ctx.eventDays.has('2026-07-03')).toBe(true);
  });

  it('covers every date that appears at any impact level', () => {
    // Coverage is what separates "quiet" from "we never looked". A low-impact
    // row is worthless as a finding and decisive as evidence that the feed had
    // that day.
    const ctx = buildMacroContext([[
      ev({ dateIsrael: '2026-08-10', impact: 'High' }),
      ev({ dateIsrael: '2026-08-11', impact: 'Low' }),
    ]]);
    expect(ctx.coveredDays.has('2026-08-10')).toBe(true);
    expect(ctx.coveredDays.has('2026-08-11')).toBe(true);
    expect(ctx.coveredDays.has('2026-08-12')).toBe(false);
  });

  it('does not infer coverage for the gap between two snapshots', () => {
    // Two rows a month apart do NOT mean the month between them was seen.
    // Treating coverage as a range would invent it.
    const ctx = buildMacroContext([
      [ev({ dateIsrael: '2026-06-01' })],
      [ev({ dateIsrael: '2026-08-01' })],
    ]);
    expect(ctx.coveredDays.has('2026-07-01')).toBe(false);
  });

  it('folds overlapping snapshots without double-counting', () => {
    const same = ev({ dateIsrael: '2026-08-10', impact: 'High', title: 'CPI m/m' });
    const ctx = buildMacroContext([[same], [{ ...same, actual: '0.3%' }]]);
    expect(ctx.eventDays.size).toBe(1);
  });

  it('drops malformed rows instead of throwing', () => {
    const ctx = buildMacroContext([
      [ev({ dateIsrael: 'not-a-date', impact: 'High' })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [null as any, undefined as any],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      null as any,
    ]);
    expect(ctx.eventDays.size).toBe(0);
    expect(ctx.coveredDays.size).toBe(0);
  });
});

describe('discoverPatterns with a macro context', () => {
  const macroIds = (cands: ReturnType<typeof discoverPatterns>) =>
    cands.filter(c => c.kind === 'macro').map(c => c.id);

  it('produces no high-impact slice without a context', () => {
    const trades = [
      ...Array.from({ length: 4 }, (_, i) => trade({ id: i + 1, dateISO: '2026-08-10' })),
      ...Array.from({ length: 4 }, (_, i) => trade({ id: i + 10, dateISO: '2026-08-11' })),
    ];
    expect(macroIds(discoverPatterns(trades, EMPTY_MACRO_CONTEXT)))
      .not.toContain('macro_high_impact');
  });

  it('splits covered days into loud and calm', () => {
    const ctx = buildMacroContext([[
      ev({ dateIsrael: '2026-08-10', impact: 'High', currency: 'USD' }),
      ev({ dateIsrael: '2026-08-11', impact: 'Low',  currency: 'USD' }),
    ]]);
    const trades = [
      ...Array.from({ length: 4 }, (_, i) => trade({ id: i + 1,  dateISO: '2026-08-10' })),
      ...Array.from({ length: 4 }, (_, i) => trade({ id: i + 10, dateISO: '2026-08-11', result: 'LOSS', pnlUsd: -50 })),
    ];
    const ids = macroIds(discoverPatterns(trades, ctx));
    expect(ids).toContain('macro_high_impact');
    expect(ids).toContain('macro_calm_day');
  });

  it('excludes uncovered days from BOTH sides', () => {
    // Four trades on a covered loud day, four on a covered calm day, and four
    // on a day the cache never saw. The third group must not appear anywhere:
    // if it leaked into `calm`, that group's sample would be 8 rather than 4.
    const ctx = buildMacroContext([[
      ev({ dateIsrael: '2026-08-10', impact: 'High', currency: 'USD' }),
      ev({ dateIsrael: '2026-08-11', impact: 'Low',  currency: 'USD' }),
    ]]);
    const trades = [
      ...Array.from({ length: 4 }, (_, i) => trade({ id: i + 1,  dateISO: '2026-08-10' })),
      ...Array.from({ length: 4 }, (_, i) => trade({ id: i + 10, dateISO: '2026-08-11' })),
      ...Array.from({ length: 4 }, (_, i) => trade({ id: i + 20, dateISO: '2026-03-02' })),
    ];
    const cands = discoverPatterns(trades, ctx);
    const calm = cands.find(c => c.id === 'macro_calm_day');
    expect(calm?.metric.trades).toBe(4);
    const loud = cands.find(c => c.id === 'macro_high_impact');
    expect(loud?.metric.trades).toBe(4);
  });

  it('keeps the first-Friday slice separate from the feed slice', () => {
    // Both may be present; they are different questions known to different
    // standards, and merging them would produce a group nobody could name.
    const ctx = buildMacroContext([
      [ev({ dateIsrael: '2026-08-07', impact: 'High', currency: 'USD', title: 'Non-Farm Employment Change' })],
      [ev({ dateIsrael: '2026-08-10', impact: 'Low', currency: 'USD' })],
      [ev({ dateIsrael: '2026-08-11', impact: 'Low', currency: 'USD' })],
    ]);
    const trades = [
      ...Array.from({ length: 4 }, (_, i) => trade({ id: i + 1,  dateISO: '2026-08-07' })),
      ...Array.from({ length: 4 }, (_, i) => trade({ id: i + 10, dateISO: '2026-08-10' })),
      ...Array.from({ length: 4 }, (_, i) => trade({ id: i + 20, dateISO: '2026-08-11' })),
    ];
    const ids = macroIds(discoverPatterns(trades, ctx));
    expect(ids).toContain('macro_release_day');
    expect(ids).toContain('macro_high_impact');
  });
});
