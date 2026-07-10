import { describe, expect, it } from 'vitest';
import { mergeById, active, needsPush, newerDoc, type Syncable } from '../../app/lib/sync/merge';

interface Row extends Syncable { id: string; v: string; }
const r = (id: string, v: string, updatedAt?: number, deleted?: boolean): Row => ({ id, v, updatedAt, deleted });

describe('mergeById', () => {
  it('unions both sides and dedupes by id', () => {
    const merged = mergeById([r('a', 'local'), r('b', 'onlyLocal')], [r('a', 'cloud'), r('c', 'onlyCloud')]);
    expect(merged.map(m => m.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('lets the newer updatedAt win', () => {
    const merged = mergeById([r('a', 'local', 100)], [r('a', 'cloud', 200)]);
    expect(merged.find(m => m.id === 'a')?.v).toBe('cloud'); // cloud is newer
    const merged2 = mergeById([r('a', 'local', 300)], [r('a', 'cloud', 200)]);
    expect(merged2.find(m => m.id === 'a')?.v).toBe('local'); // local is newer
  });

  it('lets local win an exact tie (more recent session)', () => {
    const merged = mergeById([r('a', 'local', 100)], [r('a', 'cloud', 100)]);
    expect(merged.find(m => m.id === 'a')?.v).toBe('local');
  });

  it('propagates a delete tombstone as the newer edit', () => {
    const merged = mergeById([r('a', 'gone', 200, true)], [r('a', 'here', 100)]);
    const a = merged.find(m => m.id === 'a');
    expect(a?.deleted).toBe(true);
    expect(active(merged)).toHaveLength(0);
  });

  it('an empty local side never drops cloud rows (empty session ≠ wipe)', () => {
    const merged = mergeById([], [r('a', 'cloud', 5), r('b', 'cloud', 6)]);
    expect(merged).toHaveLength(2);
  });
});

describe('needsPush', () => {
  it('is true when local has rows the cloud lacks', () => {
    expect(needsPush([r('a', 'x', 1), r('b', 'y', 1)], [r('a', 'x', 1)])).toBe(true);
  });
  it('is true when a shared id has a newer local stamp', () => {
    expect(needsPush([r('a', 'x', 9)], [r('a', 'x', 1)])).toBe(true);
  });
  it('is false when the merged result equals the cloud', () => {
    expect(needsPush([r('a', 'x', 1)], [r('a', 'x', 1)])).toBe(false);
  });
});

describe('newerDoc', () => {
  it('returns whichever side exists when the other is null', () => {
    expect(newerDoc(null, { updatedAt: 1 })).toEqual({ updatedAt: 1 });
    expect(newerDoc({ updatedAt: 1 }, null)).toEqual({ updatedAt: 1 });
  });
  it('returns the newer doc, local winning ties', () => {
    expect(newerDoc({ updatedAt: 2, s: 'l' } as { updatedAt: number; s: string }, { updatedAt: 5, s: 'c' })).toEqual({ updatedAt: 5, s: 'c' });
    expect(newerDoc({ updatedAt: 5, s: 'l' } as { updatedAt: number; s: string }, { updatedAt: 5, s: 'c' })).toEqual({ updatedAt: 5, s: 'l' });
  });
});
