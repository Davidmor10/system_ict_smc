// ─────────────────────────────────────────────────────────────────────────────
// "Why does the AI say 19 trades when I deleted them and have 3?"
//
// Deleting a trade wrote to localStorage and fired one best-effort DELETE at
// the cloud. If that request never landed — dropped connection, tab closed,
// signed out — the row stayed live in the cloud, and nothing ever retried:
//   1. the journal still looked right, because it reads localStorage; and
//   2. every server-side reader — profile, pattern memory, all the AI panels —
//      kept counting a trade the trader had deleted; and
//   3. the next hydration read that row back as "a trade the cloud has and
//      this device is missing" and restored it.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
// The document is rendered for an account; the browser is signed in as one.
// They are different things — see lib/sync/owned — so a test that seeds only
// the shared stamp is describing a tab that has gone stale.
(globalThis as any).window = { localStorage, __ONYX_OWNER__: 'user_test' };

const {
  hydrateTradesFromCloud, loadDeletedIds, loadTrades, restoreTrade, saveTrades, softDelete, loadTrash,
} = await import('../../app/lib/journal');
type TradeEntry = import('../../app/lib/journal').TradeEntry;

function trade(id: number, over: Record<string, unknown> = {}): TradeEntry {
  return {
    id, dateISO: '2026-08-20', time: '16:30', symbol: 'ES', direction: 'LONG',
    entry: 100, stop: 95, target: 115, session: 'nyam', bias: 'BULLISH',
    model: 'Silver Bullet', result: 'WIN', notes: '', updatedAt: 1000,
    ...over,
  } as TradeEntry;
}

/** Captures what hydration sent up, and replies with the given cloud state. */
function stubFetch(cloudTrades: unknown[]) {
  const puts: Array<{ trades?: unknown[]; deletedIds?: number[] }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (init?.method === 'DELETE' || init?.method === 'PATCH') {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ trades: cloudTrades }) };
  });
  return puts;
}

// Local storage is scoped to the signed-in account — a cache with no owner is
// nobody's and is neither read nor pushed (see lib/sync/owned). The suite runs
// as one signed-in trader.
const OWNER = 'user_test';
beforeEach(() => {
  store.clear();
  store.set('onyx_local_owner', OWNER);
  vi.restoreAllMocks();
});

describe('the delete ledger', () => {
  it('records a delete, and survives the trash being emptied', async () => {
    saveTrades([trade(1), trade(2)]);
    stubFetch([]);
    softDelete(loadTrades(), 1);

    expect(loadDeletedIds().map(r => r.id)).toEqual([1]);
    // Emptying the trash is a UI action; it must not erase the fact.
    store.delete('onyx_journal_trash');
    expect(loadDeletedIds().map(r => r.id)).toEqual([1]);
  });

  it('forgets an id when the trade is restored from the trash', () => {
    saveTrades([trade(1)]);
    stubFetch([]);
    const { updatedTrades, updatedTrash } = softDelete(loadTrades(), 1);
    expect(loadDeletedIds()).toHaveLength(1);

    restoreTrade(updatedTrades, updatedTrash, 1);
    expect(loadDeletedIds()).toHaveLength(0);
    expect(loadTrash()).toHaveLength(0);
  });
});

describe('hydration after a delete the cloud never heard about', () => {
  it('does not resurrect the trade', async () => {
    saveTrades([trade(1), trade(2)]);
    stubFetch([]);
    softDelete(loadTrades(), 1);

    // The cloud still lists it as live — the DELETE never landed.
    stubFetch([{ ...trade(1), deletedAt: null }, { ...trade(2), deletedAt: null }]);
    const visible = await hydrateTradesFromCloud();

    expect(visible.map(t => t.id)).toEqual([2]);
  });

  it('repairs the cloud by sending the id up with the next push', async () => {
    saveTrades([trade(1), trade(2)]);
    stubFetch([]);
    softDelete(loadTrades(), 1);

    const puts = stubFetch([{ ...trade(1), deletedAt: null }, { ...trade(2), deletedAt: null }]);
    await hydrateTradesFromCloud();

    const repair = puts.find(p => p.deletedIds && p.deletedIds.length > 0);
    expect(repair?.deletedIds).toEqual([1]);
    // …and it does not also push the deleted trade back up as live.
    expect((repair?.trades as TradeEntry[]).map(t => t.id)).toEqual([2]);
  });

  it('sends no repair when the cloud already agrees', async () => {
    saveTrades([trade(1), trade(2)]);
    stubFetch([]);
    softDelete(loadTrades(), 1);

    const puts = stubFetch([{ ...trade(1), deletedAt: '2026-08-23T09:00:00.000Z' }, { ...trade(2), deletedAt: null }]);
    await hydrateTradesFromCloud();

    expect(puts.every(p => !p.deletedIds || p.deletedIds.length === 0)).toBe(true);
  });

  it('lets an edit made elsewhere AFTER the delete win, so a real restore is not lost', async () => {
    saveTrades([trade(1), trade(2)]);
    stubFetch([]);
    softDelete(loadTrades(), 1);

    // Another device edited that trade a day later — newer than the delete.
    const laterStamp = Date.now() + 60_000;
    stubFetch([{ ...trade(1), updatedAt: laterStamp, deletedAt: null }, { ...trade(2), deletedAt: null }]);
    const visible = await hydrateTradesFromCloud();

    expect(visible.map(t => t.id).sort()).toEqual([1, 2]);
  });

  it('still pulls down a genuinely new trade from another device', async () => {
    saveTrades([trade(1)]);
    stubFetch([{ ...trade(1), deletedAt: null }, { ...trade(9), deletedAt: null }]);
    const visible = await hydrateTradesFromCloud();

    expect(visible.map(t => t.id).sort()).toEqual([1, 9]);
  });
});
