// ─────────────────────────────────────────────────────────────────────────────
// The playbook model — the shape of a setup, and the arithmetic behind the
// four numbers each card prints.
//
// Two things are load-bearing here and neither is obvious from the page:
//
//   1. A setup stores no performance. Every number is derived from the trade
//      log, matched by NAME, so the card cannot disagree with the journal.
//      The design file this page implements ships trades/winRate/avgR/pnl as
//      stored fields, because a mockup has no journal behind it; copying that
//      would have created two sources of truth with the stored one winning.
//
//   2. Absence is not zero. A setup with no decided trades has no win rate —
//      null, rendered as an em-dash. A 0% would be a claim about a setup that
//      has never been tested.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTER, emptySetup, gradeRank, normalizeSetup, renameCost,
  statsBySetupName, statsForTrades, visibleSetups,
  type Setup, type SetupFilter,
} from '../../app/lib/playbook';
import type { TradeEntry } from '../../app/lib/journal';

let seq = 0;
function T(over: Partial<TradeEntry> = {}): TradeEntry {
  seq += 1;
  return {
    id: seq,
    dateISO: '2026-08-10',
    time: '10:00',
    symbol: 'ES',
    contracts: 1,
    direction: 'LONG',
    entry: 5000,
    stop: 4990,
    target: 5030,          // planned 3R — deliberately far from the realized R
    session: 'nyam',
    bias: 'BULLISH',
    model: 'Sweep',
    result: 'WIN',
    notes: '',
    ...over,
  } as TradeEntry;
}

function S(over: Partial<Setup> = {}): Setup {
  return { ...emptySetup(), name: 'Sweep', ...over };
}

describe('statsForTrades', () => {
  it('reports nothing rather than zero when there is nothing to report', () => {
    const s = statsForTrades([]);
    expect(s.trades).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.avgR).toBeNull();
    expect(s.pnl).toBe(0);
  });

  it('averages the REALIZED R, not the reward-to-risk the trade was planned for', () => {
    // Both trades were planned for 3R. One returned 0.4R, the other -1R. A page
    // that reads the plan here shows +3.00R for a setup that lost money —
    // which is exactly the bug rMultiple's own docblock was written about.
    const stats = statsForTrades([
      T({ result: 'WIN',  tradeR: 0.4, pnlUsd: 200 }),
      T({ result: 'LOSS', tradeR: -1,  pnlUsd: -500 }),
    ]);
    expect(stats.avgR).toBeCloseTo(-0.3, 5);
    expect(stats.pnl).toBe(-300);
  });

  it('counts a win rate over decided trades only', () => {
    // 2 wins, 1 loss, plus a break-even and an open position that must not
    // dilute the rate — BE is neither outcome, OPEN has not finished happening.
    const stats = statsForTrades([
      T({ result: 'WIN', tradeR: 1 }), T({ result: 'WIN', tradeR: 1 }),
      T({ result: 'LOSS', tradeR: -1 }),
      T({ result: 'BE', tradeR: 0 }),
      T({ result: 'OPEN' }),
    ]);
    expect(stats.decided).toBe(3);
    expect(stats.winRate).toBeCloseTo(66.67, 1);
    expect(stats.trades).toBe(5);   // the count is every attributed trade
  });

  it('takes the latest trade date, whatever order they arrive in', () => {
    const stats = statsForTrades([
      T({ dateISO: '2026-08-02' }), T({ dateISO: '2026-08-14' }), T({ dateISO: '2026-08-09' }),
    ]);
    expect(stats.lastTradeISO).toBe('2026-08-14');
  });
});

describe('statsBySetupName', () => {
  it('attributes each trade to the setup its model names', () => {
    const map = statsBySetupName([
      T({ model: 'Sweep',  result: 'WIN',  tradeR: 1, pnlUsd: 500 }),
      T({ model: 'Sweep',  result: 'LOSS', tradeR: -1, pnlUsd: -250 }),
      T({ model: 'FVG H1', result: 'WIN',  tradeR: 2, pnlUsd: 900 }),
    ]);
    expect(map.get('Sweep')?.trades).toBe(2);
    expect(map.get('Sweep')?.pnl).toBe(250);
    expect(map.get('FVG H1')?.trades).toBe(1);
  });

  it('ignores trades with no setup instead of bucketing them under an empty name', () => {
    const map = statsBySetupName([T({ model: '' }), T({ model: '   ' })]);
    expect(map.size).toBe(0);
  });

  it('gives a renamed setup an honest count of what it left behind', () => {
    // Attribution is by name, so a rename is a detach. The number is what the
    // drawer warns with.
    const map = statsBySetupName([T({ model: 'Sweep' }), T({ model: 'Sweep' })]);
    expect(renameCost(map, 'Sweep')).toBe(2);
    expect(renameCost(map, 'Sweep v2')).toBe(0);
  });
});

describe('normalizeSetup', () => {
  it('fills in every field a row written before them is missing', () => {
    // The playbook shipped long before grade/assets/sessions/status existed.
    // A card that reads .sessions.length on one of these throws on the
    // trader's own data.
    const old = normalizeSetup({ id: '1', name: 'Old', description: 'x', checklist: [], tags: [] });
    expect(old).not.toBeNull();
    expect(old!.grade).toBe('B');
    expect(old!.assets).toEqual([]);
    expect(old!.sessions).toEqual([]);
    expect(old!.status).toBe('active');
    expect(old!.direction).toBe('BOTH');
    expect(old!.howItWorks).toBe('');
    expect(old!.pinned).toBe(false);
  });

  it('reads a checklist stored as bare strings', () => {
    const s = normalizeSetup({ id: '1', checklist: ['סוויפ מלא', 'CHoCH ב-M5'] });
    expect(s!.checklist).toEqual([
      { text: 'סוויפ מלא', required: true },
      { text: 'CHoCH ב-M5', required: true },
    ]);
  });

  it('keeps required:false but drops empty rows', () => {
    const s = normalizeSetup({
      id: '1',
      checklist: [{ text: 'a', required: false }, { text: '  ' }, { text: 'b', required: true }],
    });
    expect(s!.checklist).toEqual([{ text: 'a', required: false }, { text: 'b', required: true }]);
  });

  it('rejects an unknown grade or status rather than storing it', () => {
    const s = normalizeSetup({ id: '1', grade: 'S', status: 'archived', direction: 'sideways' });
    expect(s!.grade).toBe('B');
    expect(s!.status).toBe('active');
    expect(s!.direction).toBe('BOTH');
  });

  it('preserves the sync metadata the recycle bin depends on', () => {
    const s = normalizeSetup({ id: '1', deleted: true, purged: true, updatedAt: 123 });
    expect(s!.deleted).toBe(true);
    expect(s!.purged).toBe(true);
    expect(s!.updatedAt).toBe(123);
  });

  it('returns null for something that is not a setup at all', () => {
    expect(normalizeSetup(null)).toBeNull();
    expect(normalizeSetup('setup')).toBeNull();
    expect(normalizeSetup({ name: 'no id' })).toBeNull();
  });
});

describe('visibleSetups', () => {
  const stats = statsBySetupName([
    T({ model: 'A', result: 'WIN',  tradeR: 2 }),
    T({ model: 'A', result: 'WIN',  tradeR: 2 }),
    T({ model: 'B', result: 'LOSS', tradeR: -1 }),
  ]);
  const f = (over: Partial<SetupFilter> = {}): SetupFilter => ({ ...DEFAULT_FILTER, ...over });

  const a = S({ id: 'a', name: 'A', grade: 'B',  assets: ['ES'], sessions: ['nyam'], status: 'active' });
  const b = S({ id: 'b', name: 'B', grade: 'A+', assets: ['NQ'], sessions: ['london'], status: 'testing' });
  const c = S({ id: 'c', name: 'C', grade: 'A',  assets: [],     sessions: [],        status: 'paused' });
  const all = [a, b, c];

  it('sorts by grade first, breaking ties on realized R', () => {
    expect(visibleSetups(all, stats, f()).map(s => s.name)).toEqual(['B', 'C', 'A']);
  });

  it('floats pinned setups without disturbing the order among them', () => {
    const pinnedA = { ...a, pinned: true };
    expect(visibleSetups([pinnedA, b, c], stats, f()).map(s => s.name)).toEqual(['A', 'B', 'C']);
  });

  it('sorts a setup with no decided trades below every setup that has a number', () => {
    // Not above them, which is where a 0 would put it on a descending sort.
    expect(visibleSetups(all, stats, f({ sort: 'win' })).map(s => s.name)).toEqual(['A', 'B', 'C']);
  });

  // The list is read top-down to decide what to trade, which makes its order a
  // recommendation whether or not it is labelled one. Sorting compared the
  // values alone, so one winning trade — 100%, +2R — sat above a setup with a
  // long history and a real edge.
  it('does not let one winning trade outrank a measured setup', () => {
    const measured = statsBySetupName([
      ...Array.from({ length: 8 }, () => T({ model: 'A', result: 'WIN',  tradeR: 1 })),
      ...Array.from({ length: 5 }, () => T({ model: 'A', result: 'LOSS', tradeR: -1 })),
      T({ model: 'B', result: 'WIN', tradeR: 3 }),   // one trade, 100%, +3R
    ]);
    expect(visibleSetups([a, b], measured, f({ sort: 'win' })).map(s => s.name)).toEqual(['A', 'B']);
    expect(visibleSetups([a, b], measured, f({ sort: 'r'   })).map(s => s.name)).toEqual(['A', 'B']);
  });

  it('still lets the chosen sort decide the order among measured setups', () => {
    const measured = statsBySetupName([
      ...Array.from({ length: 6 }, () => T({ model: 'A', result: 'WIN',  tradeR: 1 })),
      ...Array.from({ length: 6 }, () => T({ model: 'A', result: 'LOSS', tradeR: -1 })),
      ...Array.from({ length: 9 }, () => T({ model: 'B', result: 'WIN',  tradeR: 1 })),
      ...Array.from({ length: 3 }, () => T({ model: 'B', result: 'LOSS', tradeR: -1 })),
    ]);
    expect(visibleSetups([a, b], measured, f({ sort: 'win' })).map(s => s.name)).toEqual(['B', 'A']);
  });

  it('leaves the grade sort led by the grade, tiering only the tiebreak', () => {
    const measured = statsBySetupName([
      ...Array.from({ length: 8 }, () => T({ model: 'A', result: 'WIN', tradeR: 2 })),
      ...Array.from({ length: 5 }, () => T({ model: 'A', result: 'LOSS', tradeR: -1 })),
      T({ model: 'B', result: 'WIN', tradeR: 9 }),
    ]);
    // B is A+ and A is B — the grade still wins, thin numbers or not.
    expect(visibleSetups([a, b], measured, f()).map(s => s.name)).toEqual(['B', 'A']);
  });

  it('filters by asset, session and status independently', () => {
    expect(visibleSetups(all, stats, f({ asset: 'NQ' })).map(s => s.name)).toEqual(['B']);
    expect(visibleSetups(all, stats, f({ session: 'nyam' })).map(s => s.name)).toEqual(['A']);
    expect(visibleSetups(all, stats, f({ status: 'paused' })).map(s => s.name)).toEqual(['C']);
  });

  it('excludes a setup that never named an asset once the asset filter narrows', () => {
    // Treating "unspecified" as matching everything would make the filter look
    // broken on a playbook where most setups predate the field.
    expect(visibleSetups(all, stats, f({ asset: 'ES' })).map(s => s.name)).toEqual(['A']);
  });

  it('searches the name, the summary, the prose and the tags', () => {
    const withText = S({ id: 'd', name: 'D', description: 'סוויפ של אסיה', howItWorks: 'ואז CHoCH', tags: ['FVG'] });
    const list = [withText];
    expect(visibleSetups(list, stats, f({ query: 'אסיה' }))).toHaveLength(1);
    expect(visibleSetups(list, stats, f({ query: 'choch' }))).toHaveLength(1); // case-insensitive
    expect(visibleSetups(list, stats, f({ query: 'fvg' }))).toHaveLength(1);
    expect(visibleSetups(list, stats, f({ query: 'סילבר' }))).toHaveLength(0);
  });

  it('does not mutate the array it was given', () => {
    const input = [a, b, c];
    visibleSetups(input, stats, f());
    expect(input.map(s => s.name)).toEqual(['A', 'B', 'C']);
  });
});

describe('gradeRank', () => {
  it('orders the grades the way a trader reads them', () => {
    expect(gradeRank('A+')).toBeGreaterThan(gradeRank('A'));
    expect(gradeRank('A')).toBeGreaterThan(gradeRank('B'));
    expect(gradeRank('B')).toBeGreaterThan(gradeRank('C'));
  });
});

describe('emptySetup', () => {
  it('does not collide when two are created in the same millisecond', () => {
    // The old implementation used Date.now() alone as the id, so two setups
    // added quickly shared one — and the sync layer dedupes by id.
    const ids = new Set(Array.from({ length: 200 }, () => emptySetup().id));
    expect(ids.size).toBe(200);
  });
});
