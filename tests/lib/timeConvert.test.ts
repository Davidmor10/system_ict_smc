// Moving a wall clock between zones.
//
// A TradingView export carries times with no zone on them. Onyx files a trade
// under a date and an hour in the trader's zone, and the hour decides which
// session the trade belongs to — so a file read in the wrong zone does not
// fail loudly, it silently files every trade under the wrong session. These
// are the conversions that stop that.

import { describe, expect, it } from 'vitest';
import {
  parseWallClock, wallClockToInstant, instantToWallClock, reinterpret,
  toDateISO, toHHMM, toHHMMSS,
} from '../../app/lib/time/convert';

const w = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  ({ year: y, month: mo, day: d, hour: h, minute: mi, second: s });

describe('parseWallClock', () => {
  it('reads the export\'s format, with and without seconds', () => {
    expect(parseWallClock('2026-09-08 16:56:00')).toEqual(w(2026, 9, 8, 16, 56, 0));
    expect(parseWallClock('2026-09-08 16:56')).toEqual(w(2026, 9, 8, 16, 56, 0));
    expect(parseWallClock('2026-09-08T17:01:52')).toEqual(w(2026, 9, 8, 17, 1, 52));
  });

  it('refuses anything else rather than guessing', () => {
    // A row whose timestamp cannot be read is reported to the trader, not
    // approximated — that is what the preview screen is for.
    for (const bad of ['', 'yesterday', '08/09/2026 16:56', '2026-13-01 10:00', '2026-09-08 25:00', '2026-09-08']) {
      expect(parseWallClock(bad), bad).toBeNull();
    }
  });
});

describe('the round trip', () => {
  it('returns the same reading it was given', () => {
    for (const zone of ['Asia/Jerusalem', 'America/New_York', 'UTC', 'Asia/Tokyo']) {
      const start = w(2026, 9, 8, 16, 56, 0);
      expect(instantToWallClock(wallClockToInstant(start, zone), zone)).toEqual(start);
    }
  });

  it('is exact across a DST boundary, where a single pass is an hour out', () => {
    // The offset depends on the instant, and the instant is what is being
    // solved for. Israel moves its clocks in late March and late October.
    for (const day of [
      w(2026, 3, 27, 12, 0), w(2026, 3, 28, 3, 30), w(2026, 3, 29, 12, 0),
      w(2026, 10, 24, 12, 0), w(2026, 10, 26, 12, 0),
    ]) {
      expect(instantToWallClock(wallClockToInstant(day, 'Asia/Jerusalem'), 'Asia/Jerusalem')).toEqual(day);
    }
  });
});

describe('reinterpret', () => {
  it('leaves a reading alone when the zones agree', () => {
    const start = w(2026, 9, 8, 16, 56, 0);
    expect(reinterpret(start, 'Asia/Jerusalem', 'Asia/Jerusalem')).toBe(start);
  });

  it('moves the trader\'s own trade to the hour they actually traded', () => {
    // 8 Sep 2026, MNQ. If the file were UTC and the app read it as Israel
    // time, this trade would move from the New York AM window into the
    // afternoon — the exact silent failure this exists to prevent.
    const utc = w(2026, 9, 8, 16, 56, 0);
    const israel = reinterpret(utc, 'UTC', 'Asia/Jerusalem');
    expect(toHHMM(israel)).toBe('19:56');
    expect(toDateISO(israel)).toBe('2026-09-08');
  });

  it('carries a conversion across midnight into the next day', () => {
    const late = w(2026, 9, 8, 23, 30, 0);
    const tokyo = reinterpret(late, 'Asia/Jerusalem', 'Asia/Tokyo');
    expect(toDateISO(tokyo)).toBe('2026-09-09');
    expect(toHHMM(tokyo)).toBe('05:30');
  });

  it('carries one backwards into the previous day', () => {
    const early = w(2026, 9, 8, 1, 15, 0);
    const ny = reinterpret(early, 'Asia/Jerusalem', 'America/New_York');
    expect(toDateISO(ny)).toBe('2026-09-07');
    expect(toHHMM(ny)).toBe('18:15');
  });
});

describe('formatting', () => {
  it('produces the journal\'s own shapes', () => {
    const x = w(2026, 9, 8, 7, 5, 3);
    expect(toDateISO(x)).toBe('2026-09-08');
    expect(toHHMM(x)).toBe('07:05');
    expect(toHHMMSS(x)).toBe('07:05:03');
  });
});
