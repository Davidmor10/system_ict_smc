import { describe, expect, it } from 'vitest';
import { startOfIsoWeek } from '../../app/lib/analytics/time';

describe('startOfIsoWeek', () => {
  it('returns the same Monday for every day in that week', () => {
    // 2026-07-06 is a Monday, 2026-07-12 is the following Sunday.
    expect(startOfIsoWeek('2026-07-06')).toBe('2026-07-06');
    expect(startOfIsoWeek('2026-07-08')).toBe('2026-07-06');
    expect(startOfIsoWeek('2026-07-12')).toBe('2026-07-06');
  });

  it('rolls over to the next Monday once the week ends', () => {
    expect(startOfIsoWeek('2026-07-13')).toBe('2026-07-13');
  });

  it('handles a year boundary correctly', () => {
    // 2025-12-31 is a Wednesday; that week's Monday is 2025-12-29.
    // 2026-01-01 is a Thursday, still in the same ISO week as 2025-12-29.
    expect(startOfIsoWeek('2025-12-31')).toBe('2025-12-29');
    expect(startOfIsoWeek('2026-01-01')).toBe('2025-12-29');
  });
});
