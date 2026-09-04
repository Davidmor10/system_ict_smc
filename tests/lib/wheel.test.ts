// Where a scrolling wheel column lands.
//
// The bug this file exists for: the column used to refuse a blocked row by
// springing back to the current value, which traps anyone whose value is
// already ABOVE the ceiling. Re-date a trade from yesterday to today and its
// 23:50 is hours past the exchange's clock — every row between 23 and the
// ceiling sprang back to 23, and the field could not be corrected in either
// direction. The escape test at the bottom is the one that would have caught
// it.

import { describe, expect, it } from 'vitest';
import { landedValue } from '../../app/lib/form/wheel';

const ITEM = 32;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

describe('landedValue', () => {
  it('reads the row under the band', () => {
    expect(landedValue(HOURS, 0, ITEM)).toBe(0);
    expect(landedValue(HOURS, 15 * ITEM, ITEM)).toBe(15);
    expect(landedValue(MINUTES, 39 * ITEM, ITEM)).toBe(39);
  });

  // Momentum leaves a column a few pixels off; it rounds to the nearer row.
  it('rounds a column that stopped between rows', () => {
    expect(landedValue(HOURS, 15 * ITEM + 4, ITEM)).toBe(15);
    expect(landedValue(HOURS, 15 * ITEM - 4, ITEM)).toBe(15);
    expect(landedValue(HOURS, 15 * ITEM + 20, ITEM)).toBe(16);
  });

  it('stays inside the column past either end', () => {
    expect(landedValue(HOURS, -400, ITEM)).toBe(0);
    expect(landedValue(HOURS, 99 * ITEM, ITEM)).toBe(23);
  });

  it('clamps to the ceiling instead of reporting an hour that has not happened', () => {
    expect(landedValue(HOURS, 23 * ITEM, ITEM, 15)).toBe(15);
    expect(landedValue(HOURS, 16 * ITEM, ITEM, 15)).toBe(15);
    expect(landedValue(HOURS, 15 * ITEM, ITEM, 15)).toBe(15);
    expect(landedValue(HOURS, 9 * ITEM, ITEM, 15)).toBe(9);
  });

  // THE TRAP. A value already above the ceiling has to be correctable, and it
  // is only correctable if some scroll moves it. Every one of them does.
  it('lets a value that starts above the ceiling be brought back down', () => {
    const ceiling = 15;
    for (const scrolledTo of [22, 20, 18, 16, 15, 9, 0]) {
      expect(landedValue(HOURS, scrolledTo * ITEM, ITEM, ceiling)).toBeLessThanOrEqual(ceiling);
    }
    // And a nudge in either direction leaves 23 — the state the trader is
    // stuck in — rather than resolving back to it.
    expect(landedValue(HOURS, 22 * ITEM, ITEM, ceiling)).not.toBe(23);
  });

  it('survives a column that has not laid out yet', () => {
    expect(landedValue(HOURS, NaN, ITEM)).toBe(0);
    expect(Number.isNaN(landedValue([], 0, ITEM))).toBe(true);
  });
});
