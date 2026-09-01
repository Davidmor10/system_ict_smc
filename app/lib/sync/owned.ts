// ─────────────────────────────────────────────────────────────────────────────
// Local storage that knows whose it is.
//
// THE STAMP AND THE DATA MUST NOT BE TWO SEPARATE THINGS.
//
// The first attempt kept the owner in its own key and wiped the cache when a
// different account arrived. It had one fatal property: the stamp could drift
// from the data it described. So the owner goes INSIDE each stored document:
// `{o: ownerId, v: value}`. A document whose owner is not the signed-in user
// is not returned — not cleared, not repaired, simply invisible.
//
// AND THE OWNER MUST BE THE TAB'S, NOT THE BROWSER'S.
//
// The second attempt read the signed-in account from localStorage. That is
// wrong in a way that took a two-window report to see, because localStorage is
// shared by every window on the origin, exactly like the session cookie:
//
//   window A   opened while A was signed in. Its React state holds A's
//              journal. Its JavaScript is still running.
//   window B   B signs in. The cookie for the origin is now B's — and so is
//              the localStorage stamp.
//
// Window A then asks "who am I?", reads the shared stamp, and answers "B". It
// stamps A's in-memory journal as B's and pushes it under B's cookie. The
// server compares the tab's claim against the session: both say B, so the
// write is accepted. The guard compared two values that change together, which
// makes it no guard at all.
//
// So the identity comes from the DOCUMENT — a variable the pre-hydration
// script sets from the server session that rendered this HTML. It cannot
// change while the tab is open, because the document cannot. When it disagrees
// with the shared stamp, the session changed underneath this tab: `stale()` is
// true, the tab reads and writes nothing, and the header it sends now really
// does contradict the cookie, so the server refuses it as well.
//
// A value written before this existed has no owner. It reads as nobody's, so
// it is ignored and the cloud re-hydrates it. That is the intended cost, and
// it is not a real one: localStorage is a cache, the cloud is the source of
// truth (see ./collections).
//
// Signed out, `owner()` is null and every read returns null. A logged-out tab
// holds nothing and pushes nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { LOCAL_OWNER_KEY } from '../localOwner';

/** Envelope written to localStorage. Short keys because every journal write
 *  pays for them. */
interface Owned<T> { o: string; v: T }

/** The account THIS DOCUMENT was rendered for.
 *
 *  Read from a variable the pre-hydration script sets from the server session,
 *  not from localStorage — and that distinction is the whole of this module's
 *  second fix. See the header.
 *
 *  Immutable for the life of the tab, because the document it describes is. */
export function owner(): string | null {
  if (typeof window === 'undefined') return null;
  const id = (window as unknown as { __ONYX_OWNER__?: unknown }).__ONYX_OWNER__;
  return typeof id === 'string' && id.trim() ? id : null;
}

/** The account the BROWSER is signed in as right now — shared by every tab. */
function browserOwner(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const id = window.localStorage.getItem(LOCAL_OWNER_KEY);
    return id && id.trim() ? id : null;
  } catch {
    return null;
  }
}

/** True when the session changed underneath this tab: it was rendered for one
 *  account and the browser now belongs to another.
 *
 *  Such a tab is not merely out of date, it is dangerous — it holds the first
 *  account's journal in memory and every request it sends now authenticates as
 *  the second. So it goes inert: it reads nothing and writes nothing. The
 *  server refuses it too, from the header, which is the half that survives a
 *  tab with stale JavaScript. */
export function stale(): boolean {
  const mine = owner();
  if (mine === null) return false;   // a signed-out document owns nothing
  const now = browserOwner();
  return now !== null && now !== mine;
}

function isOwned<T>(x: unknown): x is Owned<T> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
    && typeof (x as Owned<T>).o === 'string' && 'v' in (x as object);
}

/** The stored value, or null when it belongs to somebody else, to nobody, or
 *  when there is no signed-in account to compare against. */
export function readOwned<T>(key: string): T | null {
  const me = owner();
  if (me === null || stale()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isOwned<T>(parsed)) return null;   // pre-envelope value: nobody's
    return parsed.o === me ? parsed.v : null;
  } catch {
    return null;
  }
}

/** Store a value under the signed-in account. A write with nobody signed in is
 *  dropped rather than stored unattributed — an unattributed write is the
 *  thing this module exists to make impossible. */
export function writeOwned<T>(key: string, value: T): void {
  const me = owner();
  if (me === null || stale()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ o: me, v: value } satisfies Owned<T>));
  } catch { /* quota, private mode — non-fatal, the cloud still has it */ }
}
