import { describe, expect, it } from 'vitest';
import { sessionForHour, sessionStatusForDate, SESS } from '../../app/lib/sessions';

/** A Date whose getHours/getMinutes/getSeconds read as the given Israel
    wall-clock time — exactly what sessionStatusForDate expects as input. */
function atIsraelTime(h: number, m = 0, s = 0): Date {
  const d = new Date(2026, 0, 1, h, m, s);
  return d;
}

describe('sessionForHour', () => {
  it('maps an hour inside a window to that session', () => {
    expect(sessionForHour(3)).toBe('asia');
    expect(sessionForHour(10)).toBe('london');
    expect(sessionForHour(17)).toBe('nyam');
    expect(sessionForHour(21.5)).toBe('nypm');
  });

  it('respects the exact start boundary (inclusive) and end boundary (exclusive)', () => {
    expect(sessionForHour(16)).toBe('nyam');   // start, inclusive
    expect(sessionForHour(17.99)).toBe('nyam');
    expect(sessionForHour(18)).not.toBe('nyam'); // end, exclusive
  });

  it('returns null outside every tracked window', () => {
    expect(sessionForHour(0)).toBeNull();
    expect(sessionForHour(13.5)).toBeNull();
    expect(sessionForHour(23.5)).toBeNull();
  });
});

describe('sessionStatusForDate', () => {
  it('reports "live" with seconds left until that session\'s end', () => {
    const r = sessionStatusForDate(atIsraelTime(16, 30, 0)); // inside NY AM (16-18)
    expect(r.kind).toBe('live');
    expect(SESS[r.idx].key).toBe('nyam');
    expect(r.secondsLeft).toBe(90 * 60); // 1.5h to 18:00
  });

  it('reports "next" with seconds left until that session starts, same day', () => {
    const r = sessionStatusForDate(atIsraelTime(14, 0, 0)); // between London and NY AM
    expect(r.kind).toBe('next');
    expect(SESS[r.idx].key).toBe('nyam');
    expect(r.secondsLeft).toBe(2 * 3600); // 14:00 -> 16:00
  });

  it('wraps past midnight when the soonest session is tomorrow', () => {
    const r = sessionStatusForDate(atIsraelTime(23, 30, 0)); // after NY PM, before Asia (2:00)
    expect(r.kind).toBe('next');
    expect(SESS[r.idx].key).toBe('asia');
    expect(r.secondsLeft).toBe(2.5 * 3600); // 23:30 -> 02:00 next day
  });
});
