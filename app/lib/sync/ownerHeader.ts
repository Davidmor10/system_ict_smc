// ─────────────────────────────────────────────────────────────────────────────
// The tab says who it thinks it is; the server checks the cookie agrees.
//
// THE VECTOR THE OWNER ENVELOPE DOES NOT CLOSE
//
// ./owned stops a cache being READ by the wrong account. It compares the
// owner stored inside each value against the stamp the page was served with.
// Both of those live in the tab. So consider two tabs:
//
//   tab 1 — opened while A was signed in. Its JavaScript is still running,
//           its stamp still says A, and its in-memory journal is A's.
//   tab 2 — B signs in. The session cookie for the whole origin is now B's.
//
// Nothing in tab 1 has changed or has any way to notice. Its next push —
// a debounced save, a retry of a queued write, a hydration on focus — goes
// out with B's cookie attached, because cookies belong to the origin and not
// to the tab. The server authenticates it as B and writes A's trades into B's
// rows. Every check on both sides passes.
//
// That is a burst of one account's journal appearing in another's rows at a
// single timestamp, which is exactly the shape of what was found in the
// database.
//
// So the tab states its belief explicitly, and the server refuses the write
// when the belief and the cookie disagree. The disagreement is the whole
// signal: it can only happen when the session changed underneath a tab.
//
// A MISSING HEADER IS NOT A MISMATCH. A request without the header is let
// through — an older cached bundle, a route called before the stamp is set,
// a legitimate server-to-server call. Rejecting those would break saves to
// stop a leak that only an explicit contradiction proves.
// ─────────────────────────────────────────────────────────────────────────────

export const OWNER_HEADER = 'x-onyx-owner';

/** True when the tab named an account and it is not the authenticated one. */
export function ownerMismatch(headers: Headers, userId: string): boolean {
  const claimed = headers.get(OWNER_HEADER);
  if (!claimed || !claimed.trim()) return false;   // said nothing — see header
  return claimed !== userId;
}
