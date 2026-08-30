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
import { localOwnerScript, LOCAL_OWNER_KEY, DEVICE_KEYS } from '../../app/lib/localOwner';

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
  new Function('localStorage', localOwnerScript(userId))(localStorage);
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
  it('claims an unowned cache without clearing it', () => {
    // First sign-in on a fresh browser: the data is already this user's.
    seedJournal();
    run(DAVID);
    expect(store.get('onyx_journal')).toBe('[{"id":1}]');
    expect(store.get(LOCAL_OWNER_KEY)).toBe(DAVID);
  });

  it('leaves the cache alone when the same account returns', () => {
    seedJournal();
    run(DAVID);
    run(DAVID);
    expect(store.get('onyx_playbook')).toBe('[{"id":"a"}]');
  });

  // The bug itself.
  it('empties the cache when a different account signs in', () => {
    seedJournal();
    run(DAVID);
    run(ITAY);
    expect(store.get('onyx_journal')).toBeUndefined();
    expect(store.get('onyx_playbook')).toBeUndefined();
    expect(store.get('onyx_trading_rules')).toBeUndefined();
    expect(store.get('fractal_engine_journal')).toBeUndefined();
    expect(store.get(LOCAL_OWNER_KEY)).toBe(ITAY);
  });

  it('keeps device preferences across a handover', () => {
    seedJournal();
    run(DAVID);
    run(ITAY);
    for (const k of DEVICE_KEYS) expect(store.get(k)).toBeDefined();
  });

  it('never touches keys belonging to other apps on the origin', () => {
    store.set('some_other_app', 'x');
    seedJournal();
    run(DAVID);
    run(ITAY);
    expect(store.get('some_other_app')).toBe('x');
  });

  it('does nothing at all when nobody is signed in', () => {
    seedJournal();
    run(null);
    expect(store.get('onyx_journal')).toBe('[{"id":1}]');
    expect(store.get(LOCAL_OWNER_KEY)).toBeUndefined();
  });

  it('survives a localStorage that throws', () => {
    const hostile = { get length(): number { throw new Error('blocked'); } };
    expect(() => new Function('localStorage', localOwnerScript(DAVID))(hostile)).not.toThrow();
  });
});
