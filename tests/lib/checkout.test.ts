// The Bit checkout: plan constants, the verification rule, and the admin gate.
//
// The gate is the one that matters. The prototype compared the viewer's email
// on the client, which is a UI convenience — the request list carries other
// customers' names and addresses, so the real check has to hold on the server
// and it has to fail closed.

import { describe, expect, it, afterEach } from 'vitest';
import {
  PLANS, PLAN_KEYS, PLAN_DISPLAY_ORDER, DEFAULT_PLAN,
  isPlanKey, isRequestStatus, isVerificationValid, accessPeriodEnd, renewalStart,
} from '../../app/lib/payments/plans';
import { isAdminEmail } from '../../app/lib/payments/admin';

describe('the plans', () => {
  it('carries the three prices the pricing page and the terms quote', () => {
    expect(PLANS.starter.price).toBe(49);
    expect(PLANS.pro.price).toBe(99);
    expect(PLANS.deluxe.price).toBe(199);
  });

  it('grants the role that matches the plan', () => {
    expect(PLANS.starter.role).toBe('starter');
    expect(PLANS.pro.role).toBe('pro');
    expect(PLANS.deluxe.role).toBe('deluxe');
  });

  // The grid is RTL, so source order DELUXE, PRO, STARTER renders right to
  // left in the order the handoff specifies.
  it('orders the grid so it reads DELUXE, PRO, STARTER right to left', () => {
    expect([...PLAN_DISPLAY_ORDER]).toEqual(['deluxe', 'pro', 'starter']);
  });

  it('features PRO alone — one badge, one gold button', () => {
    expect(PLAN_KEYS.filter(k => PLANS[k].featured)).toEqual(['pro']);
  });

  it('opens on PRO', () => {
    expect(DEFAULT_PLAN).toBe('pro');
  });

  it('gives every plan four feature rows', () => {
    for (const k of PLAN_KEYS) expect(PLANS[k].features).toHaveLength(4);
  });

  it('accepts only the three keys', () => {
    expect(isPlanKey('pro')).toBe(true);
    expect(isPlanKey('platinum')).toBe(false);
    expect(isPlanKey(undefined)).toBe(false);
  });

  it('accepts only the three statuses', () => {
    expect(isRequestStatus('pending')).toBe(true);
    expect(isRequestStatus('refunded')).toBe(false);
  });
});

describe('the verification form', () => {
  it('needs a name of more than one character and a real address', () => {
    expect(isVerificationValid('דוד מור', 'david@example.com')).toBe(true);
  });

  it('rejects a name that is blank or a single character', () => {
    expect(isVerificationValid('', 'david@example.com')).toBe(false);
    expect(isVerificationValid('  ', 'david@example.com')).toBe(false);
    expect(isVerificationValid('ד', 'david@example.com')).toBe(false);
  });

  it('rejects an address that is not one', () => {
    expect(isVerificationValid('דוד מור', 'david')).toBe(false);
    expect(isVerificationValid('דוד מור', 'david@example')).toBe(false);
    expect(isVerificationValid('דוד מור', 'david @example.com')).toBe(false);
    expect(isVerificationValid('דוד מור', '')).toBe(false);
  });

  it('ignores surrounding whitespace, as the submit path trims it', () => {
    expect(isVerificationValid('  דוד מור  ', '  david@example.com  ')).toBe(true);
  });
});

describe('the admin gate', () => {
  const ORIGINAL = process.env.ADMIN_EMAIL;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = ORIGINAL;
  });

  it('admits the configured address', () => {
    process.env.ADMIN_EMAIL = 'owner@onyx.com';
    expect(isAdminEmail('owner@onyx.com')).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    process.env.ADMIN_EMAIL = 'owner@onyx.com';
    expect(isAdminEmail('  Owner@Onyx.COM ')).toBe(true);
  });

  // Everything below is the whole point: it fails closed.
  it('refuses everyone else', () => {
    process.env.ADMIN_EMAIL = 'owner@onyx.com';
    expect(isAdminEmail('someone@else.com')).toBe(false);
    expect(isAdminEmail('owner@onyx.com.attacker.com')).toBe(false);
    expect(isAdminEmail('')).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });

  it('supports a second owner without a code change', () => {
    process.env.ADMIN_EMAIL = 'a@onyx.com, b@onyx.com';
    expect(isAdminEmail('b@onyx.com')).toBe(true);
    expect(isAdminEmail('c@onyx.com')).toBe(false);
  });

  // An unset variable must not open the door — it falls back to the allowlist
  // the app already grants the top tier to, and to nothing wider.
  it('falls back to the owner allowlist rather than admitting anyone', () => {
    delete process.env.ADMIN_EMAIL;
    expect(isAdminEmail('davidmor030908@gmail.com')).toBe(true);
    expect(isAdminEmail('anyone@else.com')).toBe(false);
  });

  it('is not opened by an empty variable either', () => {
    process.env.ADMIN_EMAIL = '   ';
    expect(isAdminEmail('anyone@else.com')).toBe(false);
  });
});

describe('the access period', () => {
  // Bit is a one-off transfer per month; nothing charges again and nothing
  // revokes on its own, so an approval without an end date sells the product
  // once and gives it away forever.
  it('runs one month from the approval', () => {
    const end = accessPeriodEnd(new Date('2026-09-01T10:00:00Z'));
    expect(end.toISOString().slice(0, 10)).toBe('2026-10-01');
  });

  it('lands on a real date when the next month is shorter', () => {
    const end = accessPeriodEnd(new Date('2026-01-31T10:00:00Z'));
    expect(Number.isNaN(end.getTime())).toBe(false);
    expect(end.getTime()).toBeGreaterThan(new Date('2026-01-31T10:00:00Z').getTime());
  });
});

// ── a renewal extends; it does not reset ────────────────────────────────────
//
// The approval wrote "today plus a month" unconditionally, so a customer who
// paid a week before their access ran out lost that week — they had bought it
// and it was thrown away. Renew consistently early and that is a fortnight a
// year of paid time taken back.

describe('renewalStart', () => {
  const NOW = new Date('2026-09-04T12:00:00Z');

  it('starts from the end of the period they are still inside', () => {
    const inTen = '2026-09-14T12:00:00Z';
    expect(renewalStart(inTen, NOW).toISOString()).toBe(new Date(inTen).toISOString());
  });

  it('gives a first-time customer the month from today', () => {
    expect(renewalStart(null, NOW).getTime()).toBe(NOW.getTime());
    expect(renewalStart(undefined, NOW).getTime()).toBe(NOW.getTime());
  });

  // An expiry already past is not a credit to be handed back.
  it('does not backdate from an expiry that has already passed', () => {
    expect(renewalStart('2026-08-01T00:00:00Z', NOW).getTime()).toBe(NOW.getTime());
  });

  it('falls back to now rather than throwing on an unreadable date', () => {
    expect(renewalStart('not a date', NOW).getTime()).toBe(NOW.getTime());
  });

  // The whole point, stated as the arithmetic a customer would check.
  it('adds a full month to what was left, not to today', () => {
    const left = '2026-09-11T12:00:00Z';
    const end = accessPeriodEnd(renewalStart(left, NOW));
    expect(end.toISOString().slice(0, 10)).toBe('2026-10-11');
    // The resetting behaviour would have landed here instead, a week short.
    expect(end.toISOString().slice(0, 10)).not.toBe('2026-10-04');
  });
});
