// Two devices, two different edits, and only one survived.
//
// The dashboard document carried ONE timestamp for all of it, and the newer
// document won outright. So each device pushed its own view of the world
// wholesale, and the cloud copy was only ever as complete as whichever device
// wrote last:
//
//   phone   writes today's plan at 07:00 and pushes.
//   laptop  has never seen it. It writes a reminder at 09:00, snapshots the
//           keys IT has — which do not include the plan — and pushes.
//   cloud   now holds the laptop's document. The plan is gone from it.
//
// The phone still had the plan on disk, so its next push put it back and the
// loss stayed invisible — until a cache clear, which the epoch bump does to
// every device at once, and then the phone hydrates from a cloud copy that
// never had it.

import { describe, expect, it, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();
const localStorage = {
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};
const win = { localStorage, addEventListener: () => {}, __ONYX_OWNER__: 'user_test' };
vi.stubGlobal('window', win);
vi.stubGlobal('localStorage', localStorage);

/** The cloud, as a single 'dashboard' row the fake fetch serves and accepts. */
let cloudDoc: unknown = undefined;
vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    cloudDoc = JSON.parse(String(init.body)).data;
    return { ok: true, json: async () => ({}) };
  }
  return { ok: true, json: async () => ({ collections: { dashboard: cloudDoc } }) };
}));

const { hydrateDashboard } = await import('../../app/lib/sync/collections');

const DOC = 'onyx_dash_doc';
const owned = (v: unknown) => JSON.stringify({ o: 'user_test', v });

beforeEach(() => {
  store.clear();
  store.set('onyx_local_owner', 'user_test');
  cloudDoc = undefined;
});

describe('the dashboard document', () => {
  it('keeps both devices\' edits when each changed a different key', async () => {
    // The phone's push is already in the cloud, stamped early.
    cloudDoc = { keys: { onyx_dash_plan: { v: 'sweep of Asia', at: 1000 } }, updatedAt: 1000 };

    // This device has never seen it, and writes something of its own.
    store.set('onyx_dash_reminder', 'size down');

    await hydrateDashboard();

    expect(localStorage.getItem('onyx_dash_plan')).toBe('sweep of Asia');
    expect(localStorage.getItem('onyx_dash_reminder')).toBe('size down');
    // And the cloud now holds both, rather than whichever device wrote last.
    const keys = (cloudDoc as { keys: Record<string, { v: string }> }).keys;
    expect(Object.keys(keys).sort()).toEqual(['onyx_dash_plan', 'onyx_dash_reminder']);
  });

  it('lets the newer edit of the SAME key win', async () => {
    cloudDoc = { keys: { onyx_dash_plan: { v: 'from the phone', at: 9_999_999_999_999 } }, updatedAt: 9_999_999_999_999 };
    store.set('onyx_dash_plan', 'from this laptop');   // stamped now, which is older

    await hydrateDashboard();
    expect(localStorage.getItem('onyx_dash_plan')).toBe('from the phone');
  });

  it('lets this device win when its edit is the newer one', async () => {
    cloudDoc = { keys: { onyx_dash_plan: { v: 'stale', at: 1000 } }, updatedAt: 1000 };
    store.set('onyx_dash_plan', 'fresh');

    await hydrateDashboard();
    expect(localStorage.getItem('onyx_dash_plan')).toBe('fresh');
  });

  // A document written before per-key stamps. Every key in it means "this
  // device knew all of these to be true at updatedAt".
  it('reads a document from the old shape without losing its keys', async () => {
    cloudDoc = { keys: { onyx_dash_plan: 'old shape' }, updatedAt: 1000 };
    await hydrateDashboard();
    expect(localStorage.getItem('onyx_dash_plan')).toBe('old shape');
  });

  it('propagates a clear instead of letting the other device resurrect it', async () => {
    // This device had the key, then the trader cleared it.
    store.set(DOC, owned({ keys: { onyx_dash_plan: { v: 'gone now', at: 1000 } }, updatedAt: 1000 }));
    cloudDoc = { keys: { onyx_dash_plan: { v: 'gone now', at: 1000 } }, updatedAt: 1000 };

    await hydrateDashboard();

    expect(localStorage.getItem('onyx_dash_plan')).toBeNull();
    const keys = (cloudDoc as { keys: Record<string, { v: string | null }> }).keys;
    expect(keys.onyx_dash_plan.v).toBeNull();   // a tombstone, not a dropped key
  });

  // Nothing belonging to another account reaches this device's storage, even
  // when the cloud document is the newer one. See lib/sync/owned.
  it('never applies a value stamped for a different account', async () => {
    cloudDoc = {
      keys: { onyx_dash_plan: { v: JSON.stringify({ o: 'user_someone_else', v: 'theirs' }), at: 9_999_999_999_999 } },
      updatedAt: 9_999_999_999_999,
    };
    await hydrateDashboard();
    expect(localStorage.getItem('onyx_dash_plan')).toBeNull();
  });
});
