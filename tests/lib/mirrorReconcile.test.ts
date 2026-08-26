// Comparing the journal against its mirror.
//
// Every write to intelligence_trades is best-effort: the mirror catches its
// own errors so it can never take down the save that triggered it. Nothing
// ever looked again, and the consequence turned up in production — ten trades
// written to journal_trades in one bulk sync, all stamped the same
// millisecond, none of which reached the mirror. Every pattern and behaviour
// rate since was computed over a journal missing a quarter of itself, and no
// screen could have shown it.
//
// These tests cover the comparison, which is the part where a mistake either
// misses a broken row or "repairs" a correct one. The reads and writes around
// it are a thin shell by design.

import { describe, it, expect } from 'vitest';
import { diff } from '../../app/lib/coach-pipeline/mirror/reconcile';

/** The real derivation is a hash; for the comparison any injective map does. */
const uuidOf = (id: number) => `u${id}`;
const mirror = (entries: Array<[number, string | null]>) =>
  new Map(entries.map(([id, deletedAt]) => [uuidOf(id), { deletedAt }]));

describe('diff', () => {
  it('finds nothing to do when the two agree', () => {
    const out = diff(
      [{ id: 1, deletedAt: null }, { id: 2, deletedAt: null }],
      mirror([[1, null], [2, null]]),
      uuidOf,
    );
    expect(out).toEqual({ toMirror: [], toTombstone: [], orphanIds: [] });
  });

  it('re-mirrors a live trade the mirror never received', () => {
    // THE REGRESSION. The row is in the journal, the analysis cannot see it.
    const out = diff(
      [{ id: 1, deletedAt: null }, { id: 2, deletedAt: null }],
      mirror([[1, null]]),
      uuidOf,
    );
    expect(out.toMirror).toEqual([2]);
  });

  it('re-mirrors the whole batch when a bulk sync dropped it', () => {
    const journal = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, deletedAt: null }));
    const out = diff(journal, mirror([]), uuidOf);
    expect(out.toMirror).toHaveLength(10);
  });

  it('tombstones a trade deleted in the journal but still live in the mirror', () => {
    // The ghost: deleted four days ago, still counted in every rate.
    const out = diff(
      [{ id: 1, deletedAt: null }, { id: 2, deletedAt: '2026-08-22T19:04:22Z' }],
      mirror([[1, null], [2, null]]),
      uuidOf,
    );
    expect(out.toTombstone).toEqual([2]);
    expect(out.toMirror).toEqual([]);
  });

  it('lifts a tombstone the mirror kept after a restore', () => {
    // Live in the journal, marked deleted in the mirror. Re-mirroring writes
    // the row back with deleted_at null, which is the restore.
    const out = diff(
      [{ id: 1, deletedAt: null }],
      mirror([[1, '2026-08-01T00:00:00Z']]),
      uuidOf,
    );
    expect(out.toMirror).toEqual([1]);
  });

  it('leaves a trade deleted on both sides alone', () => {
    const out = diff(
      [{ id: 1, deletedAt: '2026-08-01T00:00:00Z' }],
      mirror([[1, '2026-08-01T00:00:00Z']]),
      uuidOf,
    );
    expect(out).toEqual({ toMirror: [], toTombstone: [], orphanIds: [] });
  });

  it('does not re-mirror a trade deleted in the journal and absent from the mirror', () => {
    // Nothing is wrong here: it was deleted before it was ever mirrored.
    const out = diff([{ id: 1, deletedAt: '2026-08-01T00:00:00Z' }], mirror([]), uuidOf);
    expect(out.toMirror).toEqual([]);
    expect(out.toTombstone).toEqual([]);
  });

  it('reports a mirror row with no journal source, and never repairs it', () => {
    // "I cannot find where this came from" is not the same claim as "this is
    // not theirs". Deleting on the strength of a hash that failed to match
    // would destroy data to tidy a report.
    const out = diff([{ id: 1, deletedAt: null }], mirror([[1, null], [99, null]]), uuidOf);
    expect(out.orphanIds).toEqual([uuidOf(99)]);
    expect(out.toMirror).toEqual([]);
    expect(out.toTombstone).toEqual([]);
  });

  it('counts a deleted orphan as an orphan too', () => {
    const out = diff([], mirror([[99, '2026-08-01T00:00:00Z']]), uuidOf);
    expect(out.orphanIds).toEqual([uuidOf(99)]);
  });

  it('handles an empty journal against an empty mirror', () => {
    expect(diff([], mirror([]), uuidOf)).toEqual({ toMirror: [], toTombstone: [], orphanIds: [] });
  });

  it('reproduces the live shape — 10 missing, 1 ghost, 1 orphan', () => {
    const journal = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, deletedAt: null })),
      ...Array.from({ length: 33 }, (_, i) => ({ id: 200 + i, deletedAt: null })),
      { id: 300, deletedAt: '2026-08-22T19:04:22Z' },
    ];
    const m = mirror([
      ...Array.from({ length: 33 }, (_, i) => [200 + i, null] as [number, null]),
      [300, null],
      [999, null],
    ]);
    const out = diff(journal, m, uuidOf);
    expect(out.toMirror).toHaveLength(10);
    expect(out.toTombstone).toEqual([300]);
    expect(out.orphanIds).toEqual([uuidOf(999)]);
  });

  it('is idempotent — a second pass over the repaired state does nothing', () => {
    const journal = [{ id: 1, deletedAt: null }, { id: 2, deletedAt: '2026-08-22T00:00:00Z' }];
    const before = mirror([[1, null], [2, null]]);
    const first = diff(journal, before, uuidOf);
    expect(first.toMirror.length + first.toTombstone.length).toBeGreaterThan(0);

    // The state those repairs would produce.
    const after = mirror([[1, null], [2, '2026-08-22T00:00:00Z']]);
    const second = diff(journal, after, uuidOf);
    expect(second).toEqual({ toMirror: [], toTombstone: [], orphanIds: [] });
  });
});
