// Every mutating sync request states which account the tab believes it is.
// See ./ownerHeader for why the server needs to be told something it can
// already read from the cookie.

import { owner } from './owned';
import { OWNER_HEADER } from './ownerHeader';

/** fetch, with the tab's owner stamp attached. Falls back to a plain request
 *  when nobody is signed in — the route will refuse it on its own. */
export function ownedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const me = owner();
  if (me === null) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.set(OWNER_HEADER, me);
  return fetch(input, { ...init, headers });
}
