// ─────────────────────────────────────────────────────────────────────────────
// When Bit-granted access lapses.
//
// A Bit transfer is a one-off per month. Nothing charges the customer again
// and nothing closes the account on its own, so an approval writes
// profiles.access_until a month out — and every reader of `role` has to
// respect it, or the date is decoration.
//
// THIS HAS TO HOLD IN THREE PLACES, not one. The page gate is the obvious one
// and the least expensive to miss: a lapsed trader seeing a screen they no
// longer pay for is a billing problem. The other two are the nightly pipeline
// and the manual coach run, and those spend money on AI for an account that
// stopped paying — every night, silently, for as long as nobody notices.
//
// NULL MEANS NO EXPIRY, and that is deliberate rather than a gap: accounts
// that predate manual billing, the owner, and anyone on a Stripe subscription
// carry no date and must not be downgraded by this.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeRole, type Role } from '../getUserRole';

/** The role an account actually has right now.
 *
 *  Takes the stored role and the stored expiry, and returns 'free' once the
 *  expiry is past. Pure, so the same rule can be applied on a page, in a cron
 *  and in a test without three implementations drifting apart. */
export function effectiveRole(
  storedRole: unknown,
  accessUntil: string | null | undefined,
  now: Date = new Date(),
): Role {
  const role = normalizeRole(storedRole);
  if (role === 'free') return 'free';
  if (!accessUntil) return role;              // no expiry — see the header

  const end = new Date(accessUntil);
  // An unparseable date is not evidence that access ended. Failing the other
  // way would lock out a paying customer over a malformed column.
  if (Number.isNaN(end.getTime())) return role;

  return end.getTime() > now.getTime() ? role : 'free';
}

/** True when a stored expiry has passed — for the sweep that writes the
 *  downgrade back, so the table stops claiming a plan the account has lost. */
export function hasLapsed(accessUntil: string | null | undefined, now: Date = new Date()): boolean {
  if (!accessUntil) return false;
  const end = new Date(accessUntil);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() <= now.getTime();
}
