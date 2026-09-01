// Two windows, one browser. The report that found the flaw in the fix.
//
//   window A   opened while A was signed in. Its React state holds A's
//              journal; its JavaScript is still running.
//   window B   B signs in. The session cookie belongs to the ORIGIN, not the
//              window — and so does localStorage.
//
// The previous guard asked localStorage "who am I?". Window A therefore
// answered "B", stamped A's journal as B's, and pushed it under B's cookie.
// Server and tab agreed, because both were reading the same changed value.
//
// The identity has to come from the DOCUMENT, which cannot change while the
// tab is open. These tests hold the document fixed and move the browser.

import { describe, expect, it, beforeEach } from 'vitest';

const store = new Map<string, string>();
const localStorage = {
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = { localStorage };

const { owner, stale, readOwned, writeOwned } = await import('../../app/lib/sync/owned');

const DAVID = 'user_david';
const YARDEN = 'user_yarden';

/** Render a document for `id` — what the pre-hydration script does. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderFor = (id: string | null) => { (globalThis as any).window.__ONYX_OWNER__ = id ?? ''; };
/** Sign the BROWSER in as `id` — shared by every window on the origin. */
const browserSignsIn = (id: string) => store.set('onyx_local_owner', id);

beforeEach(() => { store.clear(); renderFor(null); });

describe('a tab whose session changed underneath it', () => {
  it('knows who IT is, not who the browser has become', () => {
    renderFor(DAVID);
    browserSignsIn(DAVID);
    expect(owner()).toBe(DAVID);

    browserSignsIn(YARDEN);          // the other window signs in
    expect(owner()).toBe(DAVID);     // this tab is still David's document
    expect(stale()).toBe(true);
  });

  // The leak itself: David's journal, stamped as Yarden's, on its way to
  // Yarden's rows.
  it('writes nothing once the browser belongs to someone else', () => {
    renderFor(DAVID);
    browserSignsIn(DAVID);
    writeOwned('onyx_journal', [{ id: 1 }]);
    expect(readOwned('onyx_journal')).toEqual([{ id: 1 }]);

    browserSignsIn(YARDEN);
    writeOwned('onyx_journal', [{ id: 1 }, { id: 2 }]);
    // Unchanged on disk: the stale tab's write was dropped, not re-stamped.
    expect(JSON.parse(store.get('onyx_journal')!)).toEqual({ o: DAVID, v: [{ id: 1 }] });
  });

  it('reads nothing, so nothing can be merged upward and pushed', () => {
    renderFor(DAVID);
    browserSignsIn(DAVID);
    writeOwned('onyx_journal', [{ id: 1 }]);

    browserSignsIn(YARDEN);
    expect(readOwned('onyx_journal')).toBeNull();
  });

  it('still names itself, so the server can refuse the request', () => {
    // This is the half that has to survive a tab with stale JavaScript: the
    // header says David while the cookie says Yarden, and they finally differ.
    renderFor(DAVID);
    browserSignsIn(YARDEN);
    expect(owner()).toBe(DAVID);
  });

  it('is not stale merely because the browser signed out', () => {
    renderFor(DAVID);
    browserSignsIn(DAVID);
    store.delete('onyx_local_owner');
    expect(stale()).toBe(false);
    expect(readOwned('onyx_journal')).toBeNull();   // nothing there anyway
  });

  it('treats a signed-out document as owning nothing at all', () => {
    renderFor(null);
    browserSignsIn(YARDEN);
    expect(owner()).toBeNull();
    expect(stale()).toBe(false);
    writeOwned('onyx_journal', [{ id: 9 }]);
    expect(store.has('onyx_journal')).toBe(false);
  });

  it('works normally for the ordinary single-window case', () => {
    renderFor(YARDEN);
    browserSignsIn(YARDEN);
    expect(stale()).toBe(false);
    writeOwned('onyx_journal', [{ id: 7 }]);
    expect(readOwned('onyx_journal')).toEqual([{ id: 7 }]);
  });
});
