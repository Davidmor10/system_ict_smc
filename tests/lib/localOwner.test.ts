// The local cache belongs to one account.
//
// Every list this app keeps — trades, setups, rules, the notebook — is cached
// in localStorage and synced from there, and localStorage is keyed by ORIGIN,
// not by user. On a shared browser the second person to sign in opened the
// first person's journal; and because hydrateList merges the local copy with
// the cloud copy and pushes the result back, the first account's trades were
// then written INTO the second account.
//
// This runs the real script the browser is served, against a real-enough
// localStorage, and checks both halves.

import { describe, expect, it, beforeEach } from 'vitest';
import { localOwnerScript, LOCAL_OWNER_KEY, DEVICE_KEYS, CACHE_EPOCH, CACHE_EPOCH_KEY } from '../../app/lib/localOwner';

const store = new Map<string, string>();
const localStorage = {
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};

/** Run the served script in a scope where `localStorage` is the fake above. */
function run(userId: string | null): void {
  // `window` too: the script publishes this document's identity there, which
  // is the one value a tab cannot get from shared storage. See lib/sync/owned.
  new Function('localStorage', 'window', localOwnerScript(userId))(localStorage, {});
}

const DAVID = 'user_david';
const ITAY  = 'user_itay';

function seedJournal() {
  store.set('onyx_journal', '[{"id":1}]');
  store.set('onyx_playbook', '[{"id":"a"}]');
  store.set('onyx_trading_rules', '[]');
  store.set('fractal_engine_journal', '[{"id":9}]');
  store.set('onyx_landing_lang', 'he');
}

beforeEach(() => { store.clear(); });

describe('localOwnerScript', () => {
  // The first version CLAIMED an unstamped cache, reasoning that a fresh
  // browser is looking at its own data. That reasoning fails on exactly the
  // browser this bug was found on: every cache in existence on the day the fix
  // ships is unstamped, so whoever signs in first would claim a journal that
  // may not be theirs — the same leak, at the moment of the fix.
  it('clears an unstamped cache instead of guessing whose it is', () => {
    seedJournal();
    run(DAVID);
    expect(store.get('onyx_journal')).toBeUndefined();
    expect(store.get('onyx_playbook')).toBeUndefined();
    expect(store.get(LOCAL_OWNER_KEY)).toBe(DAVID);
  });

  it('costs nothing to clear — the cloud is the source of truth', () => {
    // Documented as a test so the trade-off is not re-argued later: a cleared
    // cache re-hydrates on the next read; an unknown owner does not.
    seedJournal();
    run(DAVID);
    expect(store.get(LOCAL_OWNER_KEY)).toBe(DAVID);
  });

  it('leaves the cache alone when the same account returns', () => {
    run(DAVID);              // claim first, on an empty browser
    seedJournal();           // then the account fills it
    run(DAVID);
    expect(store.get('onyx_playbook')).toBe('[{"id":"a"}]');
    expect(store.get('onyx_journal')).toBe('[{"id":1}]');
  });

  // The bug itself.
  it('empties the cache when a different account signs in', () => {
    run(DAVID);
    seedJournal();
    run(ITAY);
    expect(store.get('onyx_journal')).toBeUndefined();
    expect(store.get('onyx_playbook')).toBeUndefined();
    expect(store.get('onyx_trading_rules')).toBeUndefined();
    expect(store.get('fractal_engine_journal')).toBeUndefined();
    expect(store.get(LOCAL_OWNER_KEY)).toBe(ITAY);
  });

  it('keeps device preferences across a handover', () => {
    run(DAVID);
    seedJournal();
    run(ITAY);
    for (const k of DEVICE_KEYS) expect(store.get(k)).toBeDefined();
  });

  it('never touches keys belonging to other apps on the origin', () => {
    store.set('some_other_app', 'x');
    run(DAVID);
    seedJournal();
    run(ITAY);
    expect(store.get('some_other_app')).toBe('x');
  });

  it('leaves a signed-out browser alone once the epoch is stamped', () => {
    run(null);               // stamps the epoch on an empty browser
    seedJournal();
    run(null);
    expect(store.get('onyx_journal')).toBe('[{"id":1}]');
    expect(store.get(LOCAL_OWNER_KEY)).toBeUndefined();
  });

  // The epoch is how the operator says "the cloud is right, the devices are
  // not" — the one thing a browser cannot work out for itself. It has to fire
  // signed out too: a stale cache on a signed-out browser is still what gets
  // pushed back up the moment somebody signs in.
  it('empties the cache once on an epoch change, signed in or not', () => {
    seedJournal();
    run(null);
    expect(store.get('onyx_journal')).toBeUndefined();
    expect(store.get('fractal_engine_journal')).toBeUndefined();
    expect(store.get(CACHE_EPOCH_KEY)).toBe(String(CACHE_EPOCH));
  });

  it('runs the epoch wipe exactly once, not on every load', () => {
    run(DAVID);              // stamps epoch + owner
    seedJournal();
    run(DAVID);
    expect(store.get('onyx_journal')).toBe('[{"id":1}]');
  });

  // Without this the wipe would leave the previous account's stamp behind, and
  // that account's next load would look like a returning owner over a cache it
  // no longer has — harmless today, but the stamp must never outlive the data
  // it describes. That drift is what broke the previous attempt at this fix.
  it('drops the owner stamp along with the data it described', () => {
    run(DAVID);
    store.delete(CACHE_EPOCH_KEY);   // as if the epoch had been bumped
    seedJournal();
    run(null);
    expect(store.get(LOCAL_OWNER_KEY)).toBeUndefined();
    expect(store.get('onyx_journal')).toBeUndefined();
  });

  it('keeps device preferences through an epoch wipe', () => {
    seedJournal();
    run(null);
    for (const k of DEVICE_KEYS) expect(store.get(k)).toBeDefined();
  });

  it('survives a localStorage that throws', () => {
    const hostile = { get length(): number { throw new Error('blocked'); } };
    expect(() => new Function('localStorage', localOwnerScript(DAVID))(hostile)).not.toThrow();
  });
});
