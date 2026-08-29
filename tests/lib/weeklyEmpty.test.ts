// The weekly report said one thing when it had nothing: "no report yet — it
// needs at least five closed trades." A trader who deliberately took nothing
// all week read a rule about a threshold, as though not trading were a failure
// to feed the machine. It is the opposite: a week with no setup that met their
// own conditions is a week they did exactly what they should have.

import { describe, expect, it } from 'vitest';
import { weeklyEmptyState, daysIntoWeek } from '../../app/lib/intelligence/weeklyEmpty';
import { MIN_TRADES_FOR_WEEKLY } from '../../app/lib/intelligence/weeklyRules';

const MON = 1, TUE = 2, WED = 3, THU = 4, SUN = 0;

describe('daysIntoWeek', () => {
  it('counts from Monday, and closes the week on Sunday', () => {
    expect(daysIntoWeek(MON)).toBe(1);
    expect(daysIntoWeek(THU)).toBe(4);
    expect(daysIntoWeek(SUN)).toBe(7);
  });
});

describe('weeklyEmptyState', () => {
  it('does not call a week empty before it has happened', () => {
    // Monday morning with nothing logged is not a week without trades.
    expect(weeklyEmptyState(0, MON).kind).toBe('early');
    expect(weeklyEmptyState(0, TUE).kind).toBe('early');
  });

  it('treats a week the trader sat out as a decision, not a gap', () => {
    const s = weeklyEmptyState(0, THU);
    expect(s.kind).toBe('none');
    expect(s.title).toBe('לא סחרת השבוע');
    // The point of the whole file: no setup is a legitimate outcome, and a
    // journal that cannot say so quietly rewards overtrading.
    expect(s.body).toContain('סבלנות');
  });

  it('names the real count and what is still missing', () => {
    const s = weeklyEmptyState(2, WED);
    expect(s.kind).toBe('thin');
    expect(s.title).toContain('2');
    expect(s.body).toContain(String(MIN_TRADES_FOR_WEEKLY - 2));
  });

  it('reads naturally at one trade and at one missing trade', () => {
    expect(weeklyEmptyState(1, WED).title).toBe('עסקה אחת נסגרה השבוע');
    expect(weeklyEmptyState(MIN_TRADES_FOR_WEEKLY - 1, WED).body).toContain('עוד עסקה אחת');
  });

  it('always says when the report will be written, whatever the state', () => {
    for (const n of [0, 1, 4]) {
      expect(weeklyEmptyState(n, THU).note).toContain(String(MIN_TRADES_FOR_WEEKLY));
    }
  });
});
