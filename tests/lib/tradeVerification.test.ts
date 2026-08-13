// ─────────────────────────────────────────────────────────────────────────────
// Reported vs verified.
//
// A journal holds records (entry, stop, exits, sizes) and reports (I followed
// my rules, I left the stop alone). Both become columns, and once they are
// columns nothing downstream can tell which is which — although they fail
// differently: a record is wrong when something was mistyped, a report is
// wrong when memory drifts toward the outcome.
//
// The risk in this file is the opposite of the risk everywhere else. Here a
// FALSE disagreement is the expensive one: it tells the trader their journal
// is wrong when it isn't, and a trader who checks two of those stops checking.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { verifyTrade, summarizeVerification, type VerifiableTrade } from '../../app/lib/trade/verification';

const base: VerifiableTrade = {
  direction: 'LONG', entry: 20000, stop: 19980, target: 20040,
  contracts: 2, result: 'WIN', exits: null, stopMoved: null, management: null,
};
const check = (t: Partial<VerifiableTrade>, id: string) =>
  verifyTrade({ ...base, ...t }).find(c => c.id === id)!;

describe('result against the exit price', () => {
  it('agrees when the label matches where it closed', () => {
    expect(check({ result: 'WIN', exits: [{ price: 20040, contracts: 2 }] }, 'result_vs_exit').status)
      .toBe('agrees');
  });

  // The live case: a trade marked BE whose exits say it made a full R. Either
  // the wrong button or a price typed in points — both worth seeing.
  it('disagrees when the label and the exits point different ways', () => {
    const c = check({ result: 'BE', exits: [{ price: 20040, contracts: 2 }] }, 'result_vs_exit');
    expect(c.status).toBe('disagrees');
    expect(c.reported).toBe('ברייק איוון');
    expect(c.recorded).toBe('טייק');
  });

  it('says nothing when there are no exits to check against', () => {
    expect(check({ exits: null }, 'result_vs_exit').status).toBe('unverifiable');
  });

  it('says nothing about an open trade', () => {
    expect(check({ result: 'OPEN', exits: [{ price: 20010, contracts: 1 }] }, 'result_vs_exit').status)
      .toBe('unverifiable');
  });
});

describe('the stop answer against the log', () => {
  const moved = [{ at: '2026-08-01T10:00:00Z', kind: 'stop' as const, to: 19950 }];

  it('disagrees when the trader said they left it and the log says otherwise', () => {
    const c = check({ stopMoved: 'none', management: moved }, 'stop_moved_vs_log');
    expect(c.status).toBe('disagrees');
    expect(c.recorded).toBe('הרחקתי');
  });

  it('agrees when both say the same', () => {
    expect(check({ stopMoved: 'widened', management: moved }, 'stop_moved_vs_log').status).toBe('agrees');
  });

  // Without events the report is the only source. Calling that "agrees" would
  // dress one unchecked answer up as a corroborated one.
  it('is unverifiable with no log, however confident the answer', () => {
    expect(check({ stopMoved: 'none', management: [] }, 'stop_moved_vs_log').status).toBe('unverifiable');
  });
});

describe('exit contracts against the position', () => {
  it('disagrees when more contracts were closed than opened', () => {
    const c = check({ contracts: 2, exits: [{ price: 20040, contracts: 3 }] }, 'exit_contracts');
    expect(c.status).toBe('disagrees');
  });

  // A runner may still be open, or only part of the exit logged. Closing fewer
  // is legitimate and must not be flagged.
  it('accepts closing fewer than the position', () => {
    expect(check({ contracts: 2, exits: [{ price: 20040, contracts: 1 }] }, 'exit_contracts').status)
      .toBe('agrees');
  });
});

describe('the roll-up', () => {
  it('counts trades, not contradictions', () => {
    // One badly mistyped trade trips two checks at once. Reporting it as two
    // would make a single typo look like a pattern.
    const bad: VerifiableTrade = {
      ...base, result: 'BE', contracts: 1,
      exits: [{ price: 20040, contracts: 3 }],
      stopMoved: 'none',
      management: [{ at: '2026-08-01T10:00:00Z', kind: 'stop', to: 19950 }],
    };
    const s = summarizeVerification([bad, { ...base, exits: [{ price: 20040, contracts: 2 }] }]);
    expect(s.disagreeing).toBe(1);
    expect(s.checkable).toBe(2);
    expect(s.byCheck.length).toBeGreaterThan(1);
  });

  it('reports nothing for a history it cannot check', () => {
    const s = summarizeVerification([base, base]);
    expect(s.disagreeing).toBe(0);
    expect(s.checkable).toBe(0);
    expect(s.byCheck).toEqual([]);
  });
});
