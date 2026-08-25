// Scheduled-release classification.
//
// Two things here can be wrong without anything crashing: the calendar
// arithmetic (which Friday), and the timezone inversion (which day, for whom).
// Both would quietly mislabel trades and produce a comparison between two
// groups that are not what their headings say. So both are pinned to dates
// checkable by hand rather than to whatever the code currently returns.

import { describe, it, expect } from 'vitest';
import {
  firstFridayOfMonth,
  wallClockToInstant,
  isReleaseDay,
  minutesFromRelease,
  isInReleaseWindow,
  splitByRelease,
  scheduledVerdict,
  SCHEDULED_RELEASES,
  SCHEDULED_COVERAGE,
  RELEASE_ZONE,
  NFP_RELEASE_LOCAL,
} from '../../app/lib/analytics/macro';
import type { TradeEntry } from '../../app/lib/journal';

const trade = (over: Partial<TradeEntry>): TradeEntry => ({
  id: 1_700_000_000_000,
  dateISO: '2026-08-07',
  time: '15:30',
  symbol: 'MNQ',
  direction: 'LONG',
  session: 'NY_AM',
  entry: 100,
  stop: 95,
  target: 115,
  result: 'WIN',
  pnl: 100,
  contracts: 1,
  bias: 'BULLISH',
  model: '',
  notes: '',
  ...(over as object),
} as TradeEntry);

describe('firstFridayOfMonth', () => {
  it('finds the Friday when the 1st is itself a Friday', () => {
    // 2026-05-01 is a Friday.
    expect(firstFridayOfMonth(2026, 5)).toBe('2026-05-01');
  });

  it('walks forward when the month opens mid-week', () => {
    // 2026-08-01 is a Saturday, so the first Friday is the 7th.
    expect(firstFridayOfMonth(2026, 8)).toBe('2026-08-07');
    // 2026-01-01 is a Thursday → the 2nd.
    expect(firstFridayOfMonth(2026, 1)).toBe('2026-01-02');
    // 2025-03-01 is a Saturday → the 7th.
    expect(firstFridayOfMonth(2025, 3)).toBe('2025-03-07');
  });

  it('pads to a parseable ISO date', () => {
    expect(firstFridayOfMonth(2026, 2)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('never returns a day outside the first week', () => {
    for (let m = 1; m <= 12; m++) {
      const day = Number(firstFridayOfMonth(2026, m).slice(8));
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(7);
    }
  });
});

describe('wallClockToInstant', () => {
  it('resolves a New York summer wall clock to the right UTC instant', () => {
    // August is EDT, UTC-4 → 08:30 New York is 12:30 UTC.
    const inst = wallClockToInstant(RELEASE_ZONE, '2026-08-07', '08:30');
    expect(inst.toISOString()).toBe('2026-08-07T12:30:00.000Z');
  });

  it('resolves a New York winter wall clock across the DST change', () => {
    // January is EST, UTC-5 → 08:30 New York is 13:30 UTC. Same wall clock,
    // a different instant — which is the whole reason this helper exists.
    const inst = wallClockToInstant(RELEASE_ZONE, '2026-01-02', '08:30');
    expect(inst.toISOString()).toBe('2026-01-02T13:30:00.000Z');
  });

  it('round-trips through Israel time', () => {
    const inst = wallClockToInstant('Asia/Jerusalem', '2026-08-07', '15:30');
    // Israel in August is UTC+3.
    expect(inst.toISOString()).toBe('2026-08-07T12:30:00.000Z');
  });
});

describe('isReleaseDay', () => {
  it('is true on the first Friday, for an Israeli trader', () => {
    expect(isReleaseDay('2026-08-07', 'Asia/Jerusalem')).toBe(true);
  });

  it('is false on the day before and the day after', () => {
    expect(isReleaseDay('2026-08-06', 'Asia/Jerusalem')).toBe(false);
    expect(isReleaseDay('2026-08-08', 'Asia/Jerusalem')).toBe(false);
  });

  it('is false on the second Friday', () => {
    expect(isReleaseDay('2026-08-14', 'Asia/Jerusalem')).toBe(false);
  });

  it('agrees for New York and Israel — the release is inside both their days', () => {
    expect(isReleaseDay('2026-08-07', RELEASE_ZONE)).toBe(true);
    expect(isReleaseDay('2026-08-07', 'Asia/Jerusalem')).toBe(true);
  });

  it('rolls to the next calendar day for a Sydney trader in winter', () => {
    // Whether the release lands on the same local Friday depends on the month,
    // because the two hemispheres change clocks in opposite directions.
    //
    // August: New York is UTC-4, Sydney UTC+10 → 08:30 Friday New York is
    // 22:30 the same Friday in Sydney. Same square.
    expect(isReleaseDay('2026-08-07', 'Australia/Sydney')).toBe(true);
    //
    // January: New York is UTC-5, Sydney UTC+11 → 08:30 Friday New York is
    // 00:30 SATURDAY in Sydney. A Sydney trader's release day is the next
    // calendar square, and filing their Friday trades under it would put them
    // in an event that had not happened yet.
    expect(isReleaseDay('2026-01-02', 'Australia/Sydney')).toBe(false);
    expect(isReleaseDay('2026-01-03', 'Australia/Sydney')).toBe(true);
  });

  it('handles a release that falls near a month boundary', () => {
    // 2026-01-02 is the first Friday of January — the neighbouring-month
    // lookup is what keeps this from being missed.
    expect(isReleaseDay('2026-01-02', 'Asia/Jerusalem')).toBe(true);
  });
});

describe('minutesFromRelease', () => {
  it('is zero at the release minute', () => {
    // 08:30 New York = 15:30 Israel in August.
    expect(minutesFromRelease('2026-08-07', '15:30', 'Asia/Jerusalem')).toBe(0);
  });

  it('is negative before and positive after', () => {
    expect(minutesFromRelease('2026-08-07', '15:00', 'Asia/Jerusalem')).toBe(-30);
    expect(minutesFromRelease('2026-08-07', '16:30', 'Asia/Jerusalem')).toBe(60);
  });

  it('is null when the trade recorded no usable time', () => {
    expect(minutesFromRelease('2026-08-07', '', 'Asia/Jerusalem')).toBeNull();
    expect(minutesFromRelease('2026-08-07', 'later', 'Asia/Jerusalem')).toBeNull();
  });

  it('measures against the nearest release, not this month by default', () => {
    // Late January is far from both the January and February releases; the
    // returned distance should be to whichever is nearer, and enormous either
    // way — which is what keeps it out of the window.
    const mins = minutesFromRelease('2026-01-28', '15:30', 'Asia/Jerusalem');
    expect(mins).not.toBeNull();
    expect(Math.abs(mins as number)).toBeGreaterThan(60 * 24);
  });
});

describe('isInReleaseWindow', () => {
  it('includes the half hour before and the hour after', () => {
    expect(isInReleaseWindow('2026-08-07', '15:00', 'Asia/Jerusalem')).toBe(true);
    expect(isInReleaseWindow('2026-08-07', '16:30', 'Asia/Jerusalem')).toBe(true);
  });

  it('excludes just outside it on both sides', () => {
    expect(isInReleaseWindow('2026-08-07', '14:59', 'Asia/Jerusalem')).toBe(false);
    expect(isInReleaseWindow('2026-08-07', '16:31', 'Asia/Jerusalem')).toBe(false);
  });

  it('is false on an ordinary day at the same clock time', () => {
    expect(isInReleaseWindow('2026-08-14', '15:30', 'Asia/Jerusalem')).toBe(false);
  });
});

describe('splitByRelease', () => {
  it('puts every trade on exactly one side of the day split', () => {
    const trades = [
      trade({ id: 1, dateISO: '2026-08-07' }),
      trade({ id: 2, dateISO: '2026-08-10' }),
      trade({ id: 3, dateISO: '2026-09-04' }),
      trade({ id: 4, dateISO: '2026-09-05' }),
    ];
    const s = splitByRelease(trades, 'Asia/Jerusalem');
    expect(s.releaseDay.map(t => t.id).sort()).toEqual([1, 3]);
    expect(s.otherDays.map(t => t.id).sort()).toEqual([2, 4]);
    expect(s.releaseDay.length + s.otherDays.length).toBe(trades.length);
  });

  it('restricts BOTH window groups to trades that recorded a time', () => {
    // The trade with no time must appear in neither window group. Otherwise
    // the comparison silently measures "logged a time" as well as "traded the
    // release", and the heading would name only one of them.
    const trades = [
      trade({ id: 1, dateISO: '2026-08-07', time: '15:30' }),
      trade({ id: 2, dateISO: '2026-08-10', time: '15:30' }),
      trade({ id: 3, dateISO: '2026-08-11', time: '' }),
    ];
    const s = splitByRelease(trades, 'Asia/Jerusalem');
    expect(s.inWindow.map(t => t.id)).toEqual([1]);
    expect(s.outOfWindow.map(t => t.id)).toEqual([2]);
    const windowed = [...s.inWindow, ...s.outOfWindow].map(t => t.id);
    expect(windowed).not.toContain(3);
  });

  it('skips trades with no date rather than throwing', () => {
    const s = splitByRelease([trade({ id: 9, dateISO: '' })], 'Asia/Jerusalem');
    expect(s.releaseDay).toHaveLength(0);
    expect(s.otherDays).toHaveLength(0);
  });
});

describe('the dated table', () => {
  it('ships empty, and says unknown rather than quiet', () => {
    // The point of the whole design: with no verified schedule, an FOMC day
    // must never be reported as a day on which nothing happened. If someone
    // fills the table later, this test tells them to fill the coverage window
    // with it.
    expect(SCHEDULED_RELEASES).toHaveLength(0);
    expect(SCHEDULED_COVERAGE).toBeNull();
    expect(scheduledVerdict('2026-08-07')).toBe('unknown');
  });
});

describe('the release constants', () => {
  it('times the release from New York, not from the trader', () => {
    expect(RELEASE_ZONE).toBe('America/New_York');
    expect(NFP_RELEASE_LOCAL).toBe('08:30');
  });
});
