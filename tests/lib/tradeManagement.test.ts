// ─────────────────────────────────────────────────────────────────────────────
// Management events.
//
// The one place in the system where direction of travel decides whether a
// behaviour is discipline or recklessness. For a long, a HIGHER stop is closer
// to entry and therefore less risk; for a short it is the reverse. Get the sign
// backwards and the detector labels every protective move as a widening — a
// wrong answer delivered with the full confidence of a computed one, which is
// worse than not measuring it at all.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  analyzeStopMoves, resolveStopMoved, sortEvents, partialContracts,
  type ManagementEvent,
} from '../../app/lib/trade/management';

const ev = (at: string, to: number, kind: ManagementEvent['kind'] = 'stop'): ManagementEvent =>
  ({ at, kind, to });

describe('analyzeStopMoves — longs', () => {
  // Entry stop 100. Up is toward entry = protective.
  it('reads a move up as advancing', () => {
    const a = analyzeStopMoves(100, 'LONG', [ev('2026-08-01T10:00:00Z', 105)]);
    expect(a.verdict).toBe('advanced');
    expect(a.advanced).toBe(1);
    expect(a.finalStop).toBe(105);
  });

  it('reads a move down as widening', () => {
    const a = analyzeStopMoves(100, 'LONG', [ev('2026-08-01T10:00:00Z', 95)]);
    expect(a.verdict).toBe('widened');
    expect(a.widened).toBe(1);
  });

  it('counts each step, not just the endpoints', () => {
    const a = analyzeStopMoves(100, 'LONG', [
      ev('2026-08-01T10:00:00Z', 105),
      ev('2026-08-01T10:05:00Z', 95),
      ev('2026-08-01T10:09:00Z', 110),
    ]);
    expect(a.moves).toBe(3);
    expect(a.advanced).toBe(2);
    expect(a.widened).toBe(1);
    expect(a.verdict).toBe('both');
  });

  it('ignores a move to the same level', () => {
    const a = analyzeStopMoves(100, 'LONG', [ev('2026-08-01T10:00:00Z', 100)]);
    expect(a.verdict).toBe('none');
    expect(a.moves).toBe(1);
  });
});

describe('analyzeStopMoves — shorts invert', () => {
  it('reads a move down as advancing', () => {
    expect(analyzeStopMoves(100, 'SHORT', [ev('2026-08-01T10:00:00Z', 95)]).verdict).toBe('advanced');
  });

  it('reads a move up as widening', () => {
    expect(analyzeStopMoves(100, 'SHORT', [ev('2026-08-01T10:00:00Z', 105)]).verdict).toBe('widened');
  });
});

describe('order', () => {
  // Direction of travel is only meaningful in sequence, and a trade edited
  // later can append events out of order.
  it('sorts by time before reading the direction', () => {
    const out = analyzeStopMoves(100, 'LONG', [
      ev('2026-08-01T10:09:00Z', 95),
      ev('2026-08-01T10:00:00Z', 105),
    ]);
    // Chronologically: 100 → 105 (advance), 105 → 95 (widen).
    expect(out.advanced).toBe(1);
    expect(out.widened).toBe(1);
    expect(out.finalStop).toBe(95);
  });

  it('sortEvents does not mutate its input', () => {
    const input = [ev('2026-08-01T10:09:00Z', 95), ev('2026-08-01T10:00:00Z', 105)];
    sortEvents(input);
    expect(input[0].to).toBe(95);
  });
});

describe('resolveStopMoved — record beats recollection', () => {
  const moved = [ev('2026-08-01T10:00:00Z', 95)];

  it('uses the events when they exist, even against a contrary report', () => {
    const r = resolveStopMoved(100, 'LONG', moved, 'none');
    expect(r.value).toBe('widened');
    expect(r.source).toBe('recorded');
  });

  it('falls back to the report when nothing was logged', () => {
    const r = resolveStopMoved(100, 'LONG', [], 'advanced');
    expect(r.value).toBe('advanced');
    expect(r.source).toBe('reported');
  });

  it('answers nothing when neither exists — silence is not "did not move it"', () => {
    const r = resolveStopMoved(100, 'LONG', null, undefined);
    expect(r.value).toBeUndefined();
    expect(r.source).toBe('none');
  });

  // A widening cancelled by a preceding advance is still a widening. Treating
  // it as clean would let every one of them be erased by something good that
  // also happened.
  it('collapses "both" to widened for the detector', () => {
    const r = resolveStopMoved(100, 'LONG', [
      ev('2026-08-01T10:00:00Z', 105),
      ev('2026-08-01T10:05:00Z', 90),
    ], undefined);
    expect(r.value).toBe('widened');
  });

  it('ignores non-stop events when deciding whether a record exists', () => {
    const r = resolveStopMoved(100, 'LONG', [ev('2026-08-01T10:00:00Z', 120, 'target')], 'none');
    expect(r.source).toBe('reported');
  });
});

describe('partials', () => {
  it('sums the contracts closed', () => {
    expect(partialContracts([
      { at: '2026-08-01T10:00:00Z', kind: 'partial', to: 105, contracts: 1 },
      { at: '2026-08-01T10:05:00Z', kind: 'partial', to: 110, contracts: 2 },
      { at: '2026-08-01T10:06:00Z', kind: 'stop',    to: 105 },
    ])).toBe(3);
  });
});
