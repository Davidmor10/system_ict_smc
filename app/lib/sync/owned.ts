// ─────────────────────────────────────────────────────────────────────────────
// Local storage that knows whose it is.
//
// THE STAMP AND THE DATA MUST NOT BE TWO SEPARATE THINGS.
//
// The first attempt kept the owner in its own key and wiped the cache when a
// different account arrived. It had one fatal property: the stamp could drift
// from the data it described. It did — a browser holding one trader's journal
// got stamped with another trader's id, and from then on every check passed
// while the wrong journal sat there being pushed to the wrong account on every
// page load.
//
// A guard that can be out of step with what it guards is not a guard.
//
// So the owner goes INSIDE each stored document: `{o: ownerId, v: value}`. A
// document whose owner is not the signed-in user is not returned — not
// cleared, not repaired, simply invisible. Nothing invisible can be pushed to
// the cloud, and nothing can drift, because there is no second thing to drift
// from.
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

/** The signed-in account, as the server declared it.
 *
 *  Read from the key the pre-hydration script in the root layout sets from the
 *  server-rendered session — so it is available on the very first synchronous
 *  read, before React has run, which is when the journal is first loaded. */
export function owner(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const id = window.localStorage.getItem(LOCAL_OWNER_KEY);
    return id && id.trim() ? id : null;
  } catch {
    return null;
  }
}

function isOwned<T>(x: unknown): x is Owned<T> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
    && typeof (x as Owned<T>).o === 'string' && 'v' in (x as object);
}

/** The stored value, or null when it belongs to somebody else, to nobody, or
 *  when there is no signed-in account to compare against. */
export function readOwned<T>(key: string): T | null {
  const me = owner();
  if (me === null) return null;
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
  if (me === null) return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ o: me, v: value } satisfies Owned<T>));
  } catch { /* quota, private mode — non-fatal, the cloud still has it */ }
}
