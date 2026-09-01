// The journal opened on today's month, always.
//
// Right on most days and badly wrong on the rest. On the 1st of a month — or
// for anyone back from a break, a holiday, a losing streak they stepped away
// from — the calendar opened on an empty grid over a full account, while the
// header two lines above counted every trade in it. It reads as "my journal is
// gone", which is the last thing this screen should ever imply.

import { describe, expect, it } from 'vitest';
import { latestTradeMonth } from '../../app/components/JournalCalendar';
import type { TradeEntry } from '../../app/lib/journal';

const on = (dateISO: string) => ({ dateISO } as TradeEntry);

describe('latestTradeMonth', () => {
  it('finds the month of the most recent trade', () => {
    expect(latestTradeMonth([on('2026-08-03'), on('2026-08-24'), on('2026-07-11')]))
      .toEqual({ year: 2026, month: 7 });   // August is month 7
  });

  it('crosses a year boundary by date, not by string length luck', () => {
    expect(latestTradeMonth([on('2025-12-30'), on('2026-01-02')]))
      .toEqual({ year: 2026, month: 0 });
  });

  it('is null for an empty journal, so a new account still opens on today', () => {
    expect(latestTradeMonth([])).toBeNull();
  });

  it('ignores a malformed date instead of landing on year zero', () => {
    expect(latestTradeMonth([on('2026-08-03'), on('')])).toEqual({ year: 2026, month: 7 });
  });

  it('reports the single month when every trade is in one', () => {
    expect(latestTradeMonth([on('2026-08-10'), on('2026-08-11')]))
      .toEqual({ year: 2026, month: 7 });
  });
});
