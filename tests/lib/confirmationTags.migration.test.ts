import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
// The document is rendered for an account; the browser is signed in as one.
// They are different things — see lib/sync/owned — so a test that seeds only
// the shared stamp is describing a tab that has gone stale.
vi.stubGlobal('window', { localStorage: localStorageStub, addEventListener: () => {}, __ONYX_OWNER__: 'user_test' });
vi.stubGlobal('localStorage', localStorageStub);
// No cloud: hydrateList must keep local as-is and seed upward.
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));

import { loadConfirmations, CONFIRMATIONS_KEY, LEGACY_CONFIRMATIONS_KEY } from '../../app/lib/confirmationTags';

describe('migration through the real load path', () => {
  // Local storage is scoped to the signed-in account — see lib/sync/owned.
  beforeEach(() => { store.clear(); store.set('onyx_local_owner', 'user_test'); });

  it('lifts the device-only list into the synced key on first run', async () => {
    store.set(LEGACY_CONFIRMATIONS_KEY, JSON.stringify(['IFVG 1M', 'IFVG 1m', 'SMT', 'Silver Bullet']));
    const out = await loadConfirmations();
    expect(out.map(c => c.tag)).toEqual(['IFVG 1M', 'Silver Bullet']);
    expect(store.has(CONFIRMATIONS_KEY)).toBe(true);
  });

  it('leaves the legacy key untouched, so a bad ship loses nothing', async () => {
    const legacy = JSON.stringify(['Silver Bullet']);
    store.set(LEGACY_CONFIRMATIONS_KEY, legacy);
    await loadConfirmations();
    expect(store.get(LEGACY_CONFIRMATIONS_KEY)).toBe(legacy);
  });

  it('does not re-run the migration once the new key exists', async () => {
    store.set(LEGACY_CONFIRMATIONS_KEY, JSON.stringify(['Ghost']));
    // Stored the way the app stores it: owned by the signed-in account.
    store.set(CONFIRMATIONS_KEY, JSON.stringify({ o: 'user_test', v: [] }));
    const out = await loadConfirmations();
    expect(out.map(c => c.tag)).not.toContain('Ghost');
  });

  // A catalogue left by another account is not this account's catalogue, so
  // the migration runs as though the key were absent — the cache is nobody's
  // until it is claimed by a write.
  it('ignores a catalogue belonging to a different account', async () => {
    store.set(LEGACY_CONFIRMATIONS_KEY, JSON.stringify(['Silver Bullet']));
    store.set(CONFIRMATIONS_KEY, JSON.stringify({ o: 'user_someone_else', v: [{ id: 'Theirs', tag: 'Theirs' }] }));
    const out = await loadConfirmations();
    expect(out.map(c => c.tag)).not.toContain('Theirs');
  });

  it('survives a corrupt legacy value', async () => {
    store.set(LEGACY_CONFIRMATIONS_KEY, '{not json');
    await expect(loadConfirmations()).resolves.toEqual([]);
  });
});
