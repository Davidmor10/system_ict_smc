// ─────────────────────────────────────────────────────────────────────────────
// Readiness — the panel that explains an absence.
//
// It has one job and one way to fail at it: telling the trader a detector is
// working when it is blind. That reads as "the coach looked at this and found
// nothing", which is the opposite of the truth and the reason they would stop
// filling the field that would have fixed it.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { computeReadiness } from '../../app/lib/coach-pipeline/behavior/readiness';
import { MIN_DECIDED_FOR_CLAIM } from '../../app/lib/stats/evidence';
import type { TradeRow } from '../../app/lib/coach-pipeline/types';

let seq = 0;
function T(o: Partial<TradeRow> = {}): TradeRow {
  seq += 1;
  return {
    clerk_id: 'u', id: `r${seq}`,
    created_at: '2026-08-01T09:00:00Z', updated_at: '2026-08-01T09:00:00Z', deleted_at: null,
    date: '2026-08-01', time: '10:00', symbol: 'NQ', direction: 'LONG', contracts: 1,
    entry_price: 20000, stop_loss: 19980, take_profit: 20040, exit_price: null, exits: null,
    rr_planned: 2, r_multiple: null, pnl_usd: null, result: 'WIN',
    session: 'london', bias: null, setup: null, confirmations: null,
    emotional_state: null, followed_rules: null, notes: '', tags: [], screenshots: null,
    profile_processed_at: null, profile_processed_rev: 0,
    ...o,
  };
}
const find = (r: ReturnType<typeof computeReadiness>, kind: string) =>
  r.detectors.find(d => d.kind === kind)!;

describe('readiness', () => {
  it('reports blocked — not clean — when no trade carries the field', () => {
    const r = computeReadiness([T(), T(), T()]);
    expect(find(r, 'discretionary_exit').state).toBe('blocked');
    expect(find(r, 'rule_violation').state).toBe('blocked');
    expect(find(r, 'discretionary_exit').have).toBe(0);
  });

  it('counts partial progress and states the distance', () => {
    const r = computeReadiness([
      T({ exit_price: 20030 }), T({ exit_price: 20020 }), T(),
    ]);
    const d = find(r, 'discretionary_exit');
    expect(d.state).toBe('partial');
    expect(d.have).toBe(2);
    expect(d.need).toBe(MIN_DECIDED_FOR_CLAIM);
  });

  it('reports ready once the field is on enough trades', () => {
    const trades = Array.from({ length: MIN_DECIDED_FOR_CLAIM }, () => T({ exit_price: 20030 }));
    const r = computeReadiness(trades);
    expect(find(r, 'discretionary_exit').state).toBe('ready');
    expect(r.readyCount).toBeGreaterThan(0);
  });

  it('ignores open and deleted trades — they cannot carry evidence', () => {
    const r = computeReadiness([
      T({ result: 'OPEN', exit_price: 20030 }),
      T({ deleted_at: '2026-08-02T00:00:00Z', exit_price: 20030 }),
      T({ exit_price: 20030 }),
    ]);
    expect(r.tradesDecided).toBe(1);
    expect(find(r, 'discretionary_exit').have).toBe(1);
  });

  // Matches the detector: an empty confirmations box before the trader ever
  // used one says nothing about the trade.
  it('counts confirmations only from the first trade that carried one', () => {
    const r = computeReadiness([
      T({ time: '09:00' }), T({ time: '10:00' }),
      T({ time: '11:00', confirmations: ['SMT'] }), T({ time: '12:00' }),
    ]);
    expect(find(r, 'no_confirmation').have).toBe(2);
  });

  it('says nothing is ready for an empty journal', () => {
    const r = computeReadiness([]);
    expect(r.readyCount).toBe(0);
    expect(r.detectors.every(d => d.state === 'blocked')).toBe(true);
  });
});
