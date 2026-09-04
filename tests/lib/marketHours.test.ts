// When the exchange is shut.
//
// The obvious reading of "block trades when the market is closed" is to lock
// the form on a Saturday. That is the wrong feature: traders write up their
// week at the weekend, and a journal that refuses entries exactly when someone
// sits down to catch up is a journal they stop using. What cannot be true is a
// trade that HAPPENED while the exchange was shut.
//
// ES and NQ trade on CME, whose week runs Sunday evening to Friday evening New
// York time — in Israel, closed from Saturday 00:00 to Monday 01:00.

import { describe, expect, it } from 'vitest';
import {
  closureAt, closureFor, isFutureDate, dateProblem, REOPEN_HOUR, FUTURE_REASON,
} from '../../app/lib/market/hours';

// 2026-09-04 is a Friday, so the week around it is:
const FRI = '2026-09-04';
const SAT = '2026-09-05';
const SUN = '2026-09-06';
const MON = '2026-09-07';
const TUE = '2026-09-08';

describe('the weekly closure', () => {
  it('is shut all of Saturday', () => {
    for (const h of [0, 9, 23.9]) expect(closureAt(6, h)).not.toBeNull();
  });

  it('is shut all of Sunday', () => {
    for (const h of [0, 12, 23.9]) expect(closureAt(0, h)).not.toBeNull();
  });

  // The week reopens in the small hours of Monday, not on Sunday evening.
  it('is shut on Monday until the reopen hour', () => {
    expect(closureAt(1, REOPEN_HOUR - 0.5)).not.toBeNull();
    expect(closureAt(1, REOPEN_HOUR)).toBeNull();
    expect(closureAt(1, 9)).toBeNull();
  });

  // Friday is a full trading day. Naming it would have refused real trades.
  it('leaves Friday open', () => {
    for (const h of [0, 9, 17, 23.9]) expect(closureAt(5, h)).toBeNull();
  });

  it('leaves the rest of the week open', () => {
    for (const day of [2, 3, 4]) expect(closureAt(day, 12)).toBeNull();
  });
});

describe('reading it off a form', () => {
  it('refuses a Saturday trade', () => {
    expect(closureFor(SAT, '10:00')?.reason).toContain('שבת');
  });

  it('refuses a Sunday trade', () => {
    expect(closureFor(SUN, '18:00')?.reason).toContain('ראשון');
  });

  it('accepts a Friday trade', () => {
    expect(closureFor(FRI, '17:00')).toBeNull();
  });

  it('accepts Monday once the week has opened, and refuses it before', () => {
    expect(closureFor(MON, '00:30')).not.toBeNull();
    expect(closureFor(MON, '09:30')).toBeNull();
  });

  // The day-of-week must be the one written on the form, whatever timezone the
  // server happens to be in.
  it('reads the day from the date as written', () => {
    expect(closureFor(TUE, '12:00')).toBeNull();
    expect(closureFor(SAT, '12:00')).not.toBeNull();
  });

  // A trader still typing the hour should get the day-level answer, not a
  // complaint about a field they have not finished.
  it('falls back to midday when the time is missing or malformed', () => {
    expect(closureFor(SAT, undefined)).not.toBeNull();
    expect(closureFor(SAT, '')).not.toBeNull();
    expect(closureFor(TUE, 'nonsense')).toBeNull();
  });

  it('says nothing about a date it cannot parse', () => {
    expect(closureFor('', '10:00')).toBeNull();
    expect(closureFor('not-a-date', '10:00')).toBeNull();
  });
});

describe('a date that has not happened', () => {
  it('catches the mistyped year that would join every statistic', () => {
    expect(isFutureDate('2035-01-01', FRI)).toBe(true);
  });

  it('allows today and the past', () => {
    expect(isFutureDate(FRI, FRI)).toBe(false);
    expect(isFutureDate('2020-01-01', FRI)).toBe(false);
  });
});

describe('the one call the form makes', () => {
  // A future date is the more serious mistake, so it is the one reported.
  it('reports the future before the closure', () => {
    // Compared against the exported constant, not a literal: the wording is
    // rewritten from time to time and the rule is what this asserts.
    expect(dateProblem('2035-09-06', '10:00', FRI)).toBe(FUTURE_REASON);
  });

  it('reports a closure on a past date', () => {
    expect(dateProblem(SAT, '10:00', TUE)).toContain('שבת');
  });

  it('is silent on an ordinary trading day', () => {
    expect(dateProblem(FRI, '16:30', FRI)).toBeNull();
  });
});
