// How much access one approval buys.
//
// Two bugs live here, both of which pay out in the customer's favour and so
// would never have been reported:
//
//  1. The retry. An approval that marked the row and then failed to write the
//     profile can be repaired by clicking approve again — and the grant
//     EXTENDS from what the account already holds, so a retry on a row whose
//     grant had actually worked added a second month to one payment.
//
//  2. The month. `setMonth(m + 1)` rolls over: 31 January became 3 March.

import { describe, expect, it } from 'vitest';
import { grantForApproval } from '../../app/lib/payments/grant';
import { accessPeriodEnd, renewalStart } from '../../app/lib/payments/plans';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const ymd = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

describe('accessPeriodEnd is one month, not thirty-one days', () => {
  it('lands on the same day of the next month', () => {
    expect(ymd(accessPeriodEnd(at('2026-09-04')))).toBe('2026-10-04');
    expect(ymd(accessPeriodEnd(at('2026-12-31')))).toBe('2027-01-31');
  });

  // The rollover. February has no 31st, so the day is clamped to the last one
  // the month actually has instead of spilling into March.
  it('clamps a day the next month does not have', () => {
    expect(ymd(accessPeriodEnd(at('2026-01-31')))).toBe('2026-02-28');
    expect(ymd(accessPeriodEnd(at('2026-01-30')))).toBe('2026-02-28');
    expect(ymd(accessPeriodEnd(at('2026-03-31')))).toBe('2026-04-30');
    expect(ymd(accessPeriodEnd(at('2026-08-31')))).toBe('2026-09-30');
  });

  it('knows February in a leap year', () => {
    expect(ymd(accessPeriodEnd(at('2024-01-31')))).toBe('2024-02-29');
  });

  // The property the clamp is for: the end never skips a month.
  it('never lands two months out', () => {
    for (let d = 1; d <= 31; d++) {
      const from = at(`2026-01-${String(d).padStart(2, '0')}`);
      expect(accessPeriodEnd(from).getUTCMonth()).toBe(1); // February
    }
  });
});

describe('grantForApproval', () => {
  const NOW = at('2026-09-04');
  const LIVE = at('2026-09-20').toISOString();   // still inside a paid month
  const LAPSED = at('2026-08-01').toISOString(); // ran out

  it('honours a first decision, always', () => {
    const g = grantForApproval({
      alreadyDecided: false, currentAccessUntil: null, currentRole: 'free', now: NOW,
    });
    expect(g.write).toBe(true);
    expect(ymd(g.until)).toBe('2026-10-04');
  });

  // A renewal paid early keeps the days already bought.
  it('extends a first decision from the end of the period they are inside', () => {
    const g = grantForApproval({
      alreadyDecided: false, currentAccessUntil: LIVE, currentRole: 'pro', now: NOW,
    });
    expect(g.write).toBe(true);
    expect(ymd(g.until)).toBe('2026-10-20');
  });

  // THE RETRY, on a row whose grant had actually worked. Nothing to repair.
  it('refuses to extend a retry when the access is already open', () => {
    expect(grantForApproval({
      alreadyDecided: true, currentAccessUntil: LIVE, currentRole: 'pro', now: NOW,
    }).write).toBe(false);
  });

  // A grandfathered account carries no expiry at all — also nothing to repair.
  it('refuses a retry on an account with no expiry', () => {
    expect(grantForApproval({
      alreadyDecided: true, currentAccessUntil: null, currentRole: 'deluxe', now: NOW,
    }).write).toBe(false);
  });

  // THE RETRY the branch exists for: the row says approved and the customer
  // has nothing. That is the failure it is meant to repair.
  it('grants a retry when the access was never opened', () => {
    const g = grantForApproval({
      alreadyDecided: true, currentAccessUntil: null, currentRole: 'free', now: NOW,
    });
    expect(g.write).toBe(true);
    expect(ymd(g.until)).toBe('2026-10-04');
  });

  it('grants a retry when the access lapsed', () => {
    expect(grantForApproval({
      alreadyDecided: true, currentAccessUntil: LAPSED, currentRole: 'pro', now: NOW,
    }).write).toBe(true);
  });

  // The property that makes the retry safe: repeating it changes nothing.
  it('is idempotent once the access is open', () => {
    let until = grantForApproval({
      alreadyDecided: false, currentAccessUntil: null, currentRole: 'free', now: NOW,
    }).until.toISOString();

    for (let i = 0; i < 5; i++) {
      const again = grantForApproval({
        alreadyDecided: true, currentAccessUntil: until, currentRole: 'pro', now: NOW,
      });
      expect(again.write).toBe(false);
      if (again.write) until = again.until.toISOString();
    }
    expect(ymd(new Date(until))).toBe('2026-10-04');
  });
});

// The helper the extension is built on, unchanged but worth pinning here too.
describe('renewalStart', () => {
  const NOW = at('2026-09-04');
  it('starts from the later of now and the current expiry', () => {
    expect(renewalStart(at('2026-09-20').toISOString(), NOW).getTime()).toBe(at('2026-09-20').getTime());
    expect(renewalStart(at('2026-08-01').toISOString(), NOW).getTime()).toBe(NOW.getTime());
    expect(renewalStart(null, NOW).getTime()).toBe(NOW.getTime());
    expect(renewalStart('not a date', NOW).getTime()).toBe(NOW.getTime());
  });
});
