// ─────────────────────────────────────────────────────────────────────────────
// Sessions the trader owns.
//
// These were four constants. They are now a table in settings that can be
// renamed, moved, switched off, extended, and — the case the old model could
// not express at all — wrapped past midnight.
//
// The table arrives from a user-editable, cross-device settings doc, so nothing
// here trusts its shape. And a session key is stamped on trades: switching a
// session off must never make an old trade's session unreadable.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSIONS, activeSessions, hourLabel, inSession, normalizeSessions,
  overlappingSessions, parseHourLabel, sessionForHour, sessionIdxForHour,
  sessionLabel, type SessionDef,
} from '../../app/lib/sessions';

const S = (over: Partial<SessionDef> = {}): SessionDef =>
  ({ key: 'k', he: 'סשן', en: 'S', start: 9, end: 12, enabled: true, ...over });

describe('inSession', () => {
  it('matches inside the window and excludes the closing hour', () => {
    const s = S({ start: 9, end: 12 });
    expect(inSession(s, 9)).toBe(true);
    expect(inSession(s, 11.99)).toBe(true);
    expect(inSession(s, 12)).toBe(false);
    expect(inSession(s, 8.99)).toBe(false);
  });

  it('wraps past midnight when the window ends before it starts', () => {
    // The shape the old model could not hold: an Asian session that opens at
    // 22:00 and closes at 02:00.
    const night = S({ start: 22, end: 2 });
    expect(inSession(night, 22)).toBe(true);
    expect(inSession(night, 23.5)).toBe(true);
    expect(inSession(night, 0.5)).toBe(true);
    expect(inSession(night, 1.99)).toBe(true);
    expect(inSession(night, 2)).toBe(false);
    expect(inSession(night, 12)).toBe(false);
  });
});

describe('matching an hour to a session', () => {
  const table = [
    S({ key: 'london', he: 'לונדון', start: 8, end: 12 }),
    S({ key: 'nyam', he: 'ניו יורק AM', start: 16, end: 18 }),
  ];

  it('finds the window an hour falls in', () => {
    expect(sessionForHour(9, table)).toBe('london');
    expect(sessionForHour(17, table)).toBe('nyam');
  });

  it('returns null outside every window rather than guessing', () => {
    expect(sessionForHour(14, table)).toBeNull();
    expect(sessionIdxForHour(14, table)).toBe(-1);
  });

  it('ignores a session that was switched off', () => {
    // The trader does not trade New York PM. A trade logged at 21:00 belongs to
    // no session, not to the one they turned off.
    const off = [...table, S({ key: 'nypm', he: 'ניו יורק PM', start: 20, end: 23, enabled: false })];
    expect(sessionForHour(21, activeSessions(off))).toBeNull();
  });

  it('honours a moved window — London at 08:00', () => {
    // The example the whole feature exists for.
    expect(sessionForHour(8.5, table)).toBe('london');
    expect(sessionForHour(8.5, activeSessions(DEFAULT_SESSIONS))).toBeNull();
  });
});

describe('normalizeSessions — the doc is user-editable and syncs', () => {
  it('falls back to the shipped table for anything unusable', () => {
    for (const junk of [null, undefined, 'nope', 42, {}, []]) {
      expect(normalizeSessions(junk)).toEqual(DEFAULT_SESSIONS);
    }
  });

  it('never returns an empty table, which would leave no way back', () => {
    expect(normalizeSessions([{ key: '', he: '' }])).toEqual(DEFAULT_SESSIONS);
  });

  it('drops rows without a key or a name, and de-duplicates keys', () => {
    const out = normalizeSessions([
      { key: 'a', he: 'א', start: 1, end: 2 },
      { key: 'a', he: 'כפול', start: 3, end: 4 },
      { key: '', he: 'בלי מפתח', start: 5, end: 6 },
      { key: 'b', he: '', start: 7, end: 8 },
    ]);
    expect(out.map(s => s.key)).toEqual(['a']);
    expect(out[0].he).toBe('א');
  });

  it('drops a zero-width window, which would match nothing', () => {
    expect(normalizeSessions([{ key: 'z', he: 'אפס', start: 9, end: 9 }])).toEqual(DEFAULT_SESSIONS);
  });

  it('clamps hours into the day and rounds to the minute', () => {
    const [s] = normalizeSessions([{ key: 'x', he: 'ח', start: -4, end: 99, enabled: true }]);
    expect(s.start).toBe(0);
    expect(s.end).toBe(24);
  });

  it('defaults enabled to true but respects an explicit false', () => {
    expect(normalizeSessions([{ key: 'x', he: 'ח', start: 1, end: 2 }])[0].enabled).toBe(true);
    expect(normalizeSessions([{ key: 'x', he: 'ח', start: 1, end: 2, enabled: false }])[0].enabled).toBe(false);
  });

  it('gives a custom session a Latin label instead of leaving it blank', () => {
    expect(normalizeSessions([{ key: 'x', he: 'הסשן שלי', start: 1, end: 2 }])[0].en).toBe('הסשן שלי');
  });
});

describe('sessionLabel', () => {
  const table = [S({ key: 'nypm', he: 'הערב שלי', enabled: false })];

  it('names a session the trader switched off — old trades still carry it', () => {
    expect(sessionLabel('nypm', table)).toBe('הערב שלי');
  });

  it('falls back to the shipped name for a key not in the table', () => {
    expect(sessionLabel('london', table)).toBe('לונדון');
  });

  it('says "no session" for the empty states rather than leaking a token', () => {
    expect(sessionLabel('NONE', table)).toBe('ללא סשן');
    expect(sessionLabel(null, table)).toBe('ללא סשן');
  });

  it('shows an unknown key as itself rather than hiding the trade', () => {
    expect(sessionLabel('custom_zz', table)).toBe('custom_zz');
  });
});

describe('hour text', () => {
  it('round-trips', () => {
    expect(hourLabel(8)).toBe('08:00');
    expect(hourLabel(16.5)).toBe('16:30');
    expect(parseHourLabel('08:00')).toBe(8);
    expect(parseHourLabel('16:30')).toBe(16.5);
  });

  it('refuses what is not a time', () => {
    for (const bad of ['', '8', '8:0', '25:00', '10:75', 'שמונה', '--:--']) {
      expect(parseHourLabel(bad)).toBeNull();
    }
  });
});

describe('overlappingSessions', () => {
  it('is quiet on the shipped table', () => {
    expect(overlappingSessions(DEFAULT_SESSIONS)).toEqual([]);
  });

  it('names a collision the trader created', () => {
    const clash = overlappingSessions([
      S({ key: 'a', start: 9, end: 13 }),
      S({ key: 'b', start: 12, end: 15 }),
    ]);
    expect(clash).toEqual([['a', 'b']]);
  });

  it('catches a collision at the midnight seam', () => {
    // Interval arithmetic gets this wrong; the sampling loop does not.
    const clash = overlappingSessions([
      S({ key: 'night', start: 22, end: 3 }),
      S({ key: 'early', start: 1, end: 5 }),
    ]);
    expect(clash).toEqual([['night', 'early']]);
  });

  it('ignores windows that are switched off', () => {
    expect(overlappingSessions([
      S({ key: 'a', start: 9, end: 13 }),
      S({ key: 'b', start: 12, end: 15, enabled: false }),
    ])).toEqual([]);
  });
});
