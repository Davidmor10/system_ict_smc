// ─────────────────────────────────────────────────────────────────────────────
// Whether an approval should open a month, and until when.
//
// Pure. Separated from the route so the one question that decides how much
// access a payment buys can be tested without a database.
//
// THE BUG THIS EXISTS FOR. `decideRequest` reports a row that was already
// decided, so an approval that marked the row and then failed to write the
// profile could be repaired by clicking approve again. The route then ran the
// grant a second time — and the grant EXTENDS from whatever the account
// already holds. On a row whose grant had actually succeeded, the second click
// added a second month to one payment.
//
// It is not a double-click: the panel disables the buttons the moment a
// decision is optimistic. It is the retry. A function that runs long enough
// for the browser to give up has still run; the panel puts the row back to
// pending, the owner clicks again, and the customer gets two months.
//
// So a repair asks first whether there is anything to repair. Access that is
// already open was not lost, and re-granting it is not a repair.
// ─────────────────────────────────────────────────────────────────────────────

import { effectiveRole } from './access';
import { accessPeriodEnd, renewalStart } from './plans';

export interface GrantDecision {
  /** False when the account already holds what this approval would give it. */
  write: boolean;
  /** When the period should end. Meaningless when `write` is false. */
  until: Date;
}

export function grantForApproval(input: {
  /** True when the row had been decided before and this call is a retry. */
  alreadyDecided: boolean;
  /** profiles.access_until as stored, or null/undefined for no expiry. */
  currentAccessUntil: string | null | undefined;
  /** profiles.role as stored. Unknown values normalise to free. */
  currentRole: unknown;
  now?: Date;
}): GrantDecision {
  const now = input.now ?? new Date();
  const until = accessPeriodEnd(renewalStart(input.currentAccessUntil, now));

  // A first decision always writes: it is the payment being honoured.
  if (!input.alreadyDecided) return { write: true, until };

  // A retry writes only when the access it was meant to open is not open.
  // `effectiveRole` is the same rule the page gates use, so "open" here means
  // exactly what it means everywhere else — including a grandfathered account
  // with no expiry at all, which has nothing to repair either.
  const open = effectiveRole(input.currentRole, input.currentAccessUntil, now) !== 'free';
  return open ? { write: false, until } : { write: true, until };
}
