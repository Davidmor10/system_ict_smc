// A Bit transfer buys one month. Nothing charges the customer again and
// nothing closes the account on its own, so an approval writes access_until —
// and every reader of `role` has to respect it or the date is decoration.
//
// The page gate is the obvious reader and the cheapest to miss. The other two
// are the nightly pipeline and the manual coach run, and those spend money on
// AI for an account that stopped paying, every night, until somebody notices.

import { describe, expect, it } from 'vitest';
import { effectiveRole, hasLapsed } from '../../app/lib/payments/access';

const NOW = new Date('2026-09-15T12:00:00Z');
const FUTURE = '2026-10-15T12:00:00Z';
const PAST = '2026-08-15T12:00:00Z';

describe('effectiveRole', () => {
  it('keeps the plan while the month is still running', () => {
    expect(effectiveRole('pro', FUTURE, NOW)).toBe('pro');
    expect(effectiveRole('deluxe', FUTURE, NOW)).toBe('deluxe');
    expect(effectiveRole('starter', FUTURE, NOW)).toBe('starter');
  });

  it('drops to free once the month has run out', () => {
    expect(effectiveRole('pro', PAST, NOW)).toBe('free');
    expect(effectiveRole('deluxe', PAST, NOW)).toBe('free');
  });

  it('treats the exact moment of expiry as expired', () => {
    expect(effectiveRole('pro', NOW.toISOString(), NOW)).toBe('free');
  });

  // Null is not an oversight: accounts predating manual billing, the owner,
  // and anyone on a Stripe subscription carry no date and must not be
  // downgraded by this.
  it('leaves an account with no expiry alone', () => {
    expect(effectiveRole('pro', null, NOW)).toBe('pro');
    expect(effectiveRole('deluxe', undefined, NOW)).toBe('deluxe');
    expect(effectiveRole('pro', '', NOW)).toBe('pro');
  });

  // Failing the other way would lock a paying customer out over a malformed
  // column, which is a worse error than briefly over-granting.
  it('does not treat an unreadable date as an expiry', () => {
    expect(effectiveRole('pro', 'not a date', NOW)).toBe('pro');
  });

  it('cannot promote anyone', () => {
    expect(effectiveRole('free', FUTURE, NOW)).toBe('free');
    expect(effectiveRole('nonsense', FUTURE, NOW)).toBe('free');
    expect(effectiveRole(undefined, FUTURE, NOW)).toBe('free');
  });
});

describe('hasLapsed', () => {
  it('is true only for a date that has passed', () => {
    expect(hasLapsed(PAST, NOW)).toBe(true);
    expect(hasLapsed(FUTURE, NOW)).toBe(false);
  });

  it('is false when there is no expiry, so the sweep skips those rows', () => {
    expect(hasLapsed(null, NOW)).toBe(false);
    expect(hasLapsed(undefined, NOW)).toBe(false);
    expect(hasLapsed('not a date', NOW)).toBe(false);
  });
});
