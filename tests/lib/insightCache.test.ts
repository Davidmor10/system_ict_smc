// ─────────────────────────────────────────────────────────────────────────────
// The bug this file exists to prevent: delete trades from the journal and the
// AI panels keep showing this morning's text — "you have 19 trades, 82% win
// rate" over a journal holding three — because the cache key carried only the
// date. Text that describes data must expire when that data changes.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it } from 'vitest';

// The suite runs on `node`, which has no window. This is the smallest store
// the module actually uses — including `length`/`key`, which the prune walk
// needs to find the panel's entries from other days.
const store = new Map<string, string>();
const localStorage = {
  get length() { return store.size; },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = { localStorage };

const { readInsightCache, tradesFingerprint, writeInsightCache } = await import('../../app/lib/ai/insightCache');
type TradeEntry = import('../../app/lib/journal').TradeEntry;

function trade(id: number, over: Partial<TradeEntry> = {}): TradeEntry {
  return {
    id, dateISO: '2026-08-20', time: '16:30', symbol: 'ES', direction: 'LONG',
    entry: 100, stop: 95, target: 115, session: 'nyam', bias: 'BULLISH',
    model: 'Silver Bullet', result: 'WIN', notes: '', tradeR: 2, pnlUsd: 500,
    ...over,
  } as TradeEntry;
}

const nineteen = Array.from({ length: 19 }, (_, i) => trade(i + 1));
const three = nineteen.slice(0, 3);

describe('tradesFingerprint', () => {
  it('changes when trades are deleted — the reported bug', () => {
    expect(tradesFingerprint(three)).not.toBe(tradesFingerprint(nineteen));
  });

  it('changes when a trade is edited into a different outcome', () => {
    const edited = [trade(1, { result: 'LOSS', tradeR: -1, pnlUsd: -250 }), ...three.slice(1)];
    expect(tradesFingerprint(edited)).not.toBe(tradesFingerprint(three));
  });

  it('is stable across re-ordering, so a re-sort does not burn a model call', () => {
    expect(tradesFingerprint(three.slice().reverse())).toBe(tradesFingerprint(three));
  });

  it('ignores fields the insights never quote, like notes', () => {
    const annotated = [trade(1, { notes: 'כתבתי משהו ארוך אחר כך' }), ...three.slice(1)];
    expect(tradesFingerprint(annotated)).toBe(tradesFingerprint(three));
  });

  it('notices an open trade being deleted, even though its result is not final', () => {
    const withOpen = [...three, trade(4, { result: 'OPEN' })];
    expect(tradesFingerprint(withOpen)).not.toBe(tradesFingerprint(three));
  });
});

describe('readInsightCache / writeInsightCache', () => {
  // Local storage is scoped to the signed-in account — see lib/sync/owned.
  beforeEach(() => { store.clear(); store.set('onyx_local_owner', 'user_test'); });

  it('returns text written about the same trades', () => {
    writeInsightCache('onyx_ai_insights_v3_2026-08-23', 'onyx_ai_insights_v3_', tradesFingerprint(three), ['ok'], '12:15');
    expect(readInsightCache<string[]>('onyx_ai_insights_v3_2026-08-23', tradesFingerprint(three))?.value).toEqual(['ok']);
  });

  it('treats text written about a different journal as a miss', () => {
    writeInsightCache('onyx_ai_insights_v3_2026-08-23', 'onyx_ai_insights_v3_', tradesFingerprint(nineteen), ['19 trades…'], '12:15');
    expect(readInsightCache('onyx_ai_insights_v3_2026-08-23', tradesFingerprint(three))).toBeNull();
  });

  it('drops the same panel\'s entries from other days instead of piling them up', () => {
    window.localStorage.setItem('onyx_ai_insights_v3_2026-08-21', 'stale');
    window.localStorage.setItem('onyx_ai_insights_v3_2026-08-22', 'stale');
    window.localStorage.setItem('onyx_trades', 'must survive');
    writeInsightCache('onyx_ai_insights_v3_2026-08-23', 'onyx_ai_insights_v3_', 'fp', ['fresh'], '12:15');

    expect(window.localStorage.getItem('onyx_ai_insights_v3_2026-08-21')).toBeNull();
    expect(window.localStorage.getItem('onyx_ai_insights_v3_2026-08-22')).toBeNull();
    expect(window.localStorage.getItem('onyx_trades')).toBe('must survive');
    expect(readInsightCache<string[]>('onyx_ai_insights_v3_2026-08-23', 'fp')?.value).toEqual(['fresh']);
  });

  it('treats a corrupt entry as a miss rather than throwing at render time', () => {
    window.localStorage.setItem('onyx_ai_insights_v3_2026-08-23', '{not json');
    expect(readInsightCache('onyx_ai_insights_v3_2026-08-23', 'fp')).toBeNull();
  });
});
