// The vector the owner envelope does not close.
//
// Two tabs, one origin. Tab 1 was opened while A was signed in; its stamp and
// its in-memory journal are A's. In tab 2, B signs in — and the session cookie
// belongs to the ORIGIN, not the tab. Tab 1 has no way to notice. Its next
// push goes out with B's cookie, the server authenticates it as B, and A's
// trades are written into B's rows with every check on both sides passing.
//
// That is a burst of one journal appearing in another account at a single
// timestamp — the shape of what was found in the database.

import { describe, expect, it } from 'vitest';
import { ownerMismatch, OWNER_HEADER } from '../../app/lib/sync/ownerHeader';

const h = (v?: string) => new Headers(v === undefined ? {} : { [OWNER_HEADER]: v });

describe('ownerMismatch', () => {
  it('catches a tab pushing under a session that changed underneath it', () => {
    expect(ownerMismatch(h('user_a'), 'user_b')).toBe(true);
  });

  it('passes the ordinary case where the tab and the cookie agree', () => {
    expect(ownerMismatch(h('user_a'), 'user_a')).toBe(false);
  });

  // A request that names no account is not evidence of anything: an older
  // cached bundle, a call made before the stamp is set, a server-to-server
  // hop. Refusing those would break saves to stop a leak they do not prove.
  it('lets a request through when the tab claims nothing', () => {
    expect(ownerMismatch(h(), 'user_a')).toBe(false);
    expect(ownerMismatch(h(''), 'user_a')).toBe(false);
    expect(ownerMismatch(h('   '), 'user_a')).toBe(false);
  });
});
