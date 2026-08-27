// ─────────────────────────────────────────────────────────────────────────────
// The one decision both surfaces read.
//
// The nightly run acts on it; the owner preview shows what tonight will do.
// The preview used to hold its own copy of the sequence, and the copy drifted:
// it went on ranking findings by severity after the run started rotating them
// by when each was last measured, so the two named different behaviours. That
// is not a crash, it is a debugging tool that quietly lies — the worst kind of
// wrong, because it is the surface you check the others against.
//
// These tests are about the shared entry point rather than about either
// caller. If the rotation, the window slice or the record shape can be reached
// through `runBehaviorLayer`, both surfaces get them by construction.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { runBehaviorLayer } from '../../app/lib/coach-pipeline/behavior/run';
import type { StoredFinding } from '../../app/lib/coach-pipeline/behavior/memory';
import type { BehaviorKind } from '../../app/lib/coach-pipeline/behavior/behaviors';
import type { ExperimentResult } from '../../app/lib/coach-pipeline/behavior/experiment';
import type { TradeRow } from '../../app/lib/coach-pipeline/types';

let seq = 0;
function T(o: Partial<TradeRow> = {}): TradeRow {
  seq += 1;
  const day = Math.floor(seq / 8) + 1, slot = seq % 8;
  return {
    clerk_id: 'u', id: `t${seq}`,
    created_at: '2026-08-01T09:00:00Z', updated_at: '2026-08-01T09:00:00Z', deleted_at: null,
    date: `2026-08-${String(day).padStart(2, '0')}`, time: `${String(9 + slot).padStart(2, '0')}:00`,
    symbol: 'NQ', direction: 'LONG', contracts: 1,
    entry_price: 20000, stop_loss: 19980, take_profit: 20040, exit_price: 20040, exits: null,
    rr_planned: 2, r_multiple: 2, pnl_usd: 100, result: 'WIN',
    session: 'london', bias: null, setup: 'REVERSAL', confirmations: ['SMT'],
    emotional_state: null, followed_rules: true, stop_moved: null, management: null,
    notes: '', tags: [], screenshots: null,
    profile_processed_at: null, profile_processed_rev: 0,
    ...o,
  };
}

/** Forty trades carrying two confirmable behaviours at different severities:
 *  `no_confirmation` on half of them, `rule_violation` on a third. Newest
 *  first, the way `listRecentTrades` hands them over. */
function twoBehaviours(): TradeRow[] {
  const trades = Array.from({ length: 40 }, (_, i) => T({
    followed_rules: i % 3 !== 0,
    confirmations:  i % 2 === 0 ? [] : ['SMT'],
  }));
  return trades.reverse();
}

const NOW = '2026-08-21T06:00:00Z';

const finishedWindow: ExperimentResult = {
  verdict: 'unchanged', targetBefore: 0.5, targetAfter: 0.5, delta: 0,
  historicalImproved: false, rollingImproved: false, guardrails: [], broken: [],
};

/** Run once against a blank memory and keep the records, so the second run
 *  starts from something the layer itself produced rather than a hand-written
 *  fixture that could disagree with it. */
function firstRun(trades: TradeRow[]) {
  const run = runBehaviorLayer({ trades, stored: new Map(), now: '2026-08-20T06:00:00Z' });
  const stored = new Map<BehaviorKind, StoredFinding>(
    run.decisions.map(d => [d.finding.kind, d.record]),
  );
  return { run, stored };
}

describe('runBehaviorLayer', () => {
  it('decides one thing per finding, in the same order', () => {
    const run = runBehaviorLayer({ trades: twoBehaviours(), stored: new Map(), now: NOW });
    expect(run.decisions.map(d => d.finding.kind)).toEqual(run.findings.map(f => f.kind));
  });

  it('picks the most severe behaviour when nothing has been measured yet', () => {
    const { run } = firstRun(twoBehaviours());
    expect(run.primary?.kind).toBe('no_confirmation');
  });

  // The divergence itself: severity alone would hand the slot straight back
  // to the behaviour whose window just closed, and nothing else would ever
  // get a turn.
  it('passes the slot on once a behaviour has had its window measured', () => {
    const trades = twoBehaviours();
    const { stored } = firstRun(trades);
    const measured = stored.get('no_confirmation')!;
    stored.set('no_confirmation', {
      ...measured, isPrimary: true, statusSince: '2026-08-19T06:00:00Z',
      experimentResult: finishedWindow,
    });

    const run = runBehaviorLayer({ trades, stored, now: NOW });
    expect(run.primary?.kind).toBe('rule_violation');
  });

  it('records where the window opened, so it can be counted by position later', () => {
    const trades = twoBehaviours();
    const { stored } = firstRun(trades);

    const run = runBehaviorLayer({ trades, stored, now: NOW });
    const opened = run.decisions.find(d => d.record.experiment)!;
    expect(opened.record.experimentBaseline?.tradesAtStart).toBe(trades.length);
  });

  it('is pure — the same input twice gives the same answer', () => {
    const trades = twoBehaviours();
    const { stored } = firstRun(trades);
    const a = runBehaviorLayer({ trades, stored, now: NOW });
    const b = runBehaviorLayer({ trades, stored, now: NOW });
    expect(b.decisions.map(d => d.record)).toEqual(a.decisions.map(d => d.record));
  });
});
