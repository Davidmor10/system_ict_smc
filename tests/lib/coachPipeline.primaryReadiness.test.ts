// The deadlock that stopped the tracking loop from ever starting.
//
// Only ONE behaviour is primary at a time — deliberate, because a trader
// measuring four things is measuring none. A measurement window opens only for
// a primary that is 'confirmed'.
//
// Ranking was by severity alone, so an 'investigating' finding could take the
// single slot and hold it: it was not ready to start, and the findings that
// WERE ready could not get the slot. Observed in production — two confirmed
// behaviours idle for a fortnight behind an investigating one, and the whole
// tracking feature dark as a result.

import { describe, it, expect } from 'vitest';
import { pickPrimary } from '../../app/lib/coach-pipeline/behavior/finding';
import type { BehaviorFinding, FindingStatus } from '../../app/lib/coach-pipeline/behavior/finding';
import type { BehaviorKind } from '../../app/lib/coach-pipeline/behavior/behaviors';

const f = (
  kind: BehaviorKind,
  status: FindingStatus,
  priorityScore: number,
): BehaviorFinding => ({
  kind, status, priorityScore,
  contrast: 'present',
  occurrences: 6, opportunities: 30, rate: 0.2,
} as BehaviorFinding);

describe('a confirmed finding outranks one still being investigated', () => {
  it('picks the confirmed one even when the other scores higher', () => {
    // The production shape exactly: an investigating finding scoring above two
    // confirmed ones. Before the fix it took the slot and nothing ever started.
    const primary = pickPrimary([
      f('rule_violation',     'investigating', 9),
      f('discretionary_exit', 'confirmed',     4),
      f('size_spike',         'confirmed',     3),
    ]).primary;
    expect(primary?.status).toBe('confirmed');
    expect(primary?.kind).toBe('discretionary_exit');
  });

  it('still ranks by severity among the confirmed ones', () => {
    // The fix must not flatten the existing ordering — it only decides which
    // group gets looked at first.
    const primary = pickPrimary([
      f('size_spike',         'confirmed', 8),
      f('discretionary_exit', 'confirmed', 3),
    ]).primary;
    expect(primary?.kind).toBe('size_spike');
  });

  it('falls back to the investigating one when nothing is confirmed', () => {
    // Readiness is a preference, not a filter. With nothing ready, the most
    // severe finding still leads — the trader sees it, it just cannot start a
    // window yet.
    const primary = pickPrimary([
      f('rule_violation', 'investigating', 5),
      f('stop_widened',   'investigating', 2),
    ]).primary;
    expect(primary?.kind).toBe('rule_violation');
  });

  it('leaves everything else in the watching list', () => {
    const { primary, watching } = pickPrimary([
      f('rule_violation',     'investigating', 9),
      f('discretionary_exit', 'confirmed',     4),
      f('size_spike',         'confirmed',     3),
    ]);
    expect(watching).toHaveLength(2);
    expect(watching).not.toContain(primary);
  });
});

describe('the incumbent cannot hold a slot it cannot use', () => {
  it('loses to a challenger that can actually start', () => {
    // The incumbent normally keeps the slot unless clearly beaten, which stops
    // the primary flip-flopping week to week. That protection must not apply
    // when the incumbent is the reason nothing can begin — otherwise the
    // deadlock returns on the next run.
    const primary = pickPrimary(
      [f('rule_violation', 'investigating', 9), f('discretionary_exit', 'confirmed', 2)],
      'rule_violation',
    ).primary;
    expect(primary?.kind).toBe('discretionary_exit');
  });

  it('keeps its grip against a challenger of the same readiness', () => {
    // Within a tier the old margin rule is untouched: a marginally higher
    // score does not justify abandoning a measurement mid-flight.
    const primary = pickPrimary(
      [f('size_spike', 'confirmed', 5.4), f('discretionary_exit', 'confirmed', 5)],
      'discretionary_exit',
    ).primary;
    expect(primary?.kind).toBe('discretionary_exit');
  });

  it('still yields to a clearly worse problem in the same tier', () => {
    const primary = pickPrimary(
      [f('size_spike', 'confirmed', 20), f('discretionary_exit', 'confirmed', 5)],
      'discretionary_exit',
    ).primary;
    expect(primary?.kind).toBe('size_spike');
  });
});

describe('a running experiment is never interrupted', () => {
  it('holds its place against a confirmed finding that scores higher', () => {
    // Interrupting a running measurement throws away the only thing that could
    // have said whether it worked. This predates the readiness fix and must
    // survive it.
    const primary = pickPrimary(
      [f('size_spike', 'confirmed', 50), f('discretionary_exit', 'experiment', 1)],
      'discretionary_exit',
    ).primary;
    expect(primary?.kind).toBe('discretionary_exit');
  });
});
