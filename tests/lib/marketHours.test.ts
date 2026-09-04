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
  closureAt, closureFor, isFutureDate, isFutureTime, minutesOf,
  dateProblem, REOPEN_HOUR, FUTURE_REASON, FUTURE_TIME_REASON,
} from '../../app/lib/market/hours';

// 2026-09-04 is a Friday, so the week around it is:
const THU = '2026-09-03';
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

// ─────────────────────────────────────────────────────────────────────────────
// An hour that has not happened yet.
//
// The date rule alone lets today's form take 23:50 at nine in the morning, and
// that trade then joins every session bucket, every hour-of-day pattern and
// every count as though it had been taken. The clock is only consulted ON
// TODAY: 23:50 is an ordinary hour on every other day of the year.
// ─────────────────────────────────────────────────────────────────────────────

describe('minutesOf', () => {
  it('reads a wall clock', () => {
    expect(minutesOf('00:00')).toBe(0);
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('23:59')).toBe(1439);
  });

  it('refuses what is not one', () => {
    for (const bad of ['', null, undefined, '9:3', 'now', '24:00', '12:60', '12:00:00']) {
      expect(minutesOf(bad)).toBeNull();
    }
  });

  // A single digit hour is what a hand-typed time looks like.
  it('accepts a single-digit hour', () => {
    expect(minutesOf('9:05')).toBe(545);
  });
});

describe('isFutureTime', () => {
  const NOW = '15:39';

  it('blocks later today', () => {
    expect(isFutureTime(FRI, '15:40', FRI, NOW)).toBe(true);
    expect(isFutureTime(FRI, '17:00', FRI, NOW)).toBe(true);
    expect(isFutureTime(FRI, '23:59', FRI, NOW)).toBe(true);
  });

  it('allows this minute and every one before it', () => {
    expect(isFutureTime(FRI, NOW, FRI, NOW)).toBe(false);
    expect(isFutureTime(FRI, '15:38', FRI, NOW)).toBe(false);
    expect(isFutureTime(FRI, '00:00', FRI, NOW)).toBe(false);
  });

  // The rule that keeps this from breaking ordinary journalling: on any past
  // day the whole day is fair game, evening included.
  it('says nothing about any day but today', () => {
    expect(isFutureTime(THU, '23:50', FRI, NOW)).toBe(false);
    expect(isFutureTime(TUE, '23:59', FRI, NOW)).toBe(false);
  });

  it('is silent while the hour is still being typed', () => {
    expect(isFutureTime(FRI, '', FRI, NOW)).toBe(false);
    expect(isFutureTime(FRI, null, FRI, NOW)).toBe(false);
    expect(isFutureTime(FRI, '1', FRI, NOW)).toBe(false);
  });

  // No clock, no claim. A caller without one must not have times refused at
  // random by a fallback.
  it('is silent without a clock to compare against', () => {
    expect(isFutureTime(FRI, '23:59', FRI, undefined)).toBe(false);
    expect(isFutureTime(FRI, '23:59', FRI, '')).toBe(false);
  });
});

describe('the one call the form makes', () => {
  // A future date is the more serious mistake, so it is the one reported.
  it('reports the future before the closure', () => {
    // Compared against the exported constant, not a literal: the wording is
    // rewritten from time to time and the rule is what this asserts.
    expect(dateProblem('2035-09-06', '10:00', FRI)).toBe(FUTURE_REASON);
  });

  it('reports the hour before the closure', () => {
    // Today is a Friday and the exchange is open, so only the clock objects.
    expect(dateProblem(FRI, '23:00', FRI, '15:39')).toBe(FUTURE_TIME_REASON);
  });

  it('leaves a past day alone whatever the hour', () => {
    expect(dateProblem(THU, '23:50', FRI, '09:00')).toBeNull();
  });

  it('does not check the hour when no clock was given', () => {
    expect(dateProblem(FRI, '23:50', FRI)).toBeNull();
  });

  // The order the three answers come in, on one date that trips all of them.
  it('reports the date before the hour', () => {
    expect(dateProblem('2035-09-06', '23:00', FRI, '09:00')).toBe(FUTURE_REASON);
  });

  it('reports a closure on a past date', () => {
    expect(dateProblem(SAT, '10:00', TUE)).toContain('שבת');
  });

  it('is silent on an ordinary trading day', () => {
    expect(dateProblem(FRI, '16:30', FRI)).toBeNull();
  });
});
