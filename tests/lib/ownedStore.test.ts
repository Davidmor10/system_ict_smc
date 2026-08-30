// One trader's journal landed in another trader's database.
//
// Both signed in on the same browser. localStorage is keyed by ORIGIN, so the
// second account read the first account's cached journal — and because
// `loadTrades` pushes what it reads to the cloud, the first account's 33 trades
// were written INTO the second account's rows.
//
// THE FIRST FIX WAS NOT ENOUGH, AND THAT IS WHAT THIS FILE IS REALLY ABOUT.
//
// It kept the owner in a separate key and wiped the cache when a different
// account arrived. The stamp could drift from the data it described, and it
// did: a browser holding one journal got stamped with the other trader's id,
// and from then on every check passed while the wrong journal sat there being
// re-pushed on every page load.
//
// The owner lives inside each stored value now. A value belonging to somebody
// else is not returned, so there is nothing to push and nothing to drift.

import { describe, expect, it, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();
const localStorage = {
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};
vi.stubGlobal('window', { localStorage, addEventListener: () => {} });
vi.stubGlobal('localStorage', localStorage);

const { owner, readOwned, writeOwned } = await import('../../app/lib/sync/owned');
const { LOCAL_OWNER_KEY } = await import('../../app/lib/localOwner');

const DAVID = 'user_david';
const ITAY  = 'user_itay';
const signIn = (id: string | null) => {
  if (id === null) store.delete(LOCAL_OWNER_KEY);
  else store.set(LOCAL_OWNER_KEY, id);
};

beforeEach(() => { store.clear(); });

describe('owner', () => {
  it('is null when nobody is signed in', () => {
    expect(owner()).toBeNull();
    signIn('');
    expect(owner()).toBeNull();
  });
});

describe('readOwned / writeOwned', () => {
  it('round-trips a value for the account that wrote it', () => {
    signIn(DAVID);
    writeOwned('onyx_journal', [{ id: 1 }]);
    expect(readOwned('onyx_journal')).toEqual([{ id: 1 }]);
  });

  // The bug, in one assertion.
  it('does not hand one account the value another account wrote', () => {
    signIn(DAVID);
    writeOwned('onyx_journal', [{ id: 1 }, { id: 2 }]);
    signIn(ITAY);
    expect(readOwned('onyx_journal')).toBeNull();
  });

  it('leaves the other account\'s value intact rather than destroying it', () => {
    signIn(DAVID);
    writeOwned('onyx_journal', [{ id: 1 }]);
    signIn(ITAY);
    readOwned('onyx_journal');
    signIn(DAVID);
    expect(readOwned('onyx_journal')).toEqual([{ id: 1 }]);
  });

  it('treats a value written before owners existed as nobody\'s', () => {
    // Every cache in existence on the day this ships. Ignored, then
    // re-hydrated from the cloud — which is the source of truth.
    signIn(DAVID);
    store.set('onyx_journal', JSON.stringify([{ id: 99 }]));
    expect(readOwned('onyx_journal')).toBeNull();
  });

  it('reads nothing while signed out', () => {
    signIn(DAVID);
    writeOwned('onyx_journal', [{ id: 1 }]);
    signIn(null);
    expect(readOwned('onyx_journal')).toBeNull();
  });

  it('refuses to write anything unattributed', () => {
    signIn(null);
    writeOwned('onyx_journal', [{ id: 1 }]);
    expect(store.has('onyx_journal')).toBe(false);
  });

  it('survives corrupt storage without throwing', () => {
    signIn(DAVID);
    store.set('onyx_journal', '{not json');
    expect(readOwned('onyx_journal')).toBeNull();
  });
});

describe('the journal never pushes another account\'s trades', () => {
  it('loads nothing, and therefore sends nothing, for the wrong account', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchSpy);
    const { loadTrades, saveTrades, JOURNAL_KEY } = await import('../../app/lib/journal');

    signIn(DAVID);
    saveTrades([{
      id: 1, dateISO: '2026-08-03', time: '10:00', symbol: 'ES', contracts: 1,
      direction: 'LONG', entry: 100, stop: 99, target: 102, session: 'nyam',
      bias: 'BULLISH', model: 'FVG', result: 'WIN', notes: '',
    }]);
    expect(store.has(JOURNAL_KEY)).toBe(true);

    fetchSpy.mockClear();
    signIn(ITAY);
    expect(loadTrades()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
