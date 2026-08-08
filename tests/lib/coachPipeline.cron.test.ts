import { describe, expect, it } from 'vitest';
import {
  israelToday,
  israelDayOfWeek,
  stableHash,
  scheduleSlotFor,
} from '../../app/lib/coach-pipeline/dates';
import { __internals as scheduleInternals } from '../../app/lib/coach-pipeline/pipelines/scheduleNightlyJobs';

// ═══════════════════════════════════════════════════════════════════════════
// dates.ts
// ═══════════════════════════════════════════════════════════════════════════

describe('israelToday', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(israelToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is close to the current UTC date (±1 day depending on TZ offset)', () => {
    const iso  = israelToday();
    const utc  = new Date().toISOString().slice(0, 10);
    const diff = Math.abs(Date.parse(iso) - Date.parse(utc)) / (1000 * 60 * 60 * 24);
    expect(diff).toBeLessThanOrEqual(1);
  });

  it('accepts an explicit `now` for testability', () => {
    // 2026-08-15 20:00 UTC = 2026-08-15 23:00 IL (still same day either way).
    expect(israelToday(new Date('2026-08-15T20:00:00Z'))).toBe('2026-08-15');
    // 2026-08-15 22:30 UTC = 2026-08-16 01:30 IL — Israel already tomorrow.
    expect(israelToday(new Date('2026-08-15T22:30:00Z'))).toBe('2026-08-16');
  });
});

describe('israelDayOfWeek', () => {
  it('returns 0-6', () => {
    const dow = israelDayOfWeek();
    expect(dow).toBeGreaterThanOrEqual(0);
    expect(dow).toBeLessThanOrEqual(6);
  });

  it('Sunday is 0 (a known Sunday in Israel)', () => {
    // 2026-08-16 10:00 UTC = 2026-08-16 13:00 IL, a Sunday.
    expect(israelDayOfWeek(new Date('2026-08-16T10:00:00Z'))).toBe(0);
  });

  it('Saturday is 6 (a known Saturday in Israel)', () => {
    expect(israelDayOfWeek(new Date('2026-08-15T10:00:00Z'))).toBe(6);
  });
});

describe('stableHash', () => {
  it('is deterministic — same input → same hash', () => {
    expect(stableHash('user_abc')).toBe(stableHash('user_abc'));
  });

  it('is non-negative', () => {
    expect(stableHash('anything')).toBeGreaterThanOrEqual(0);
  });

  it('empty string yields 0', () => {
    expect(stableHash('')).toBe(0);
  });

  it('typically distributes distinct inputs to distinct slots (window 60)', () => {
    const buckets = new Set<number>();
    for (let i = 0; i < 50; i += 1) buckets.add(stableHash(`user_${i}`) % 60);
    // At least half the slots hit — cheap sanity, not a distribution proof.
    expect(buckets.size).toBeGreaterThan(20);
  });
});

describe('scheduleSlotFor', () => {
  const now = new Date('2026-08-15T01:00:00Z');

  it('places the job within the window', () => {
    for (let i = 0; i < 20; i += 1) {
      const at = scheduleSlotFor(`user_${i}`, 60, now);
      const offsetMin = (at.getTime() - now.getTime()) / 60_000;
      expect(offsetMin).toBeGreaterThanOrEqual(0);
      expect(offsetMin).toBeLessThan(60);
    }
  });

  it('is stable per user across calls', () => {
    const a = scheduleSlotFor('user_x', 60, now);
    const b = scheduleSlotFor('user_x', 60, now);
    expect(a.getTime()).toBe(b.getTime());
  });

  it('honors the window size', () => {
    for (let i = 0; i < 20; i += 1) {
      const at = scheduleSlotFor(`user_${i}`, 30, now);
      const offsetMin = (at.getTime() - now.getTime()) / 60_000;
      expect(offsetMin).toBeLessThan(30);
    }
  });

  it('handles zero-window gracefully (never divides by zero)', () => {
    const at = scheduleSlotFor('user_x', 0, now);
    expect(at.getTime() - now.getTime()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Eligibility rule (scheduleNightlyJobs internals)
// ═══════════════════════════════════════════════════════════════════════════

const { isEligibleToday } = scheduleInternals;

describe('isEligibleToday — plan tier cadence', () => {
  it('free is never eligible', () => {
    for (let d = 0; d <= 6; d += 1) {
      expect(isEligibleToday('free', d)).toBe(false);
    }
  });

  it('pro and deluxe are eligible every day', () => {
    for (let d = 0; d <= 6; d += 1) {
      expect(isEligibleToday('pro',    d)).toBe(true);
      expect(isEligibleToday('deluxe', d)).toBe(true);
    }
  });

  it('starter is eligible only Sun/Tue/Thu (0/2/4)', () => {
    expect(isEligibleToday('starter', 0)).toBe(true);   // Sun
    expect(isEligibleToday('starter', 1)).toBe(false);  // Mon
    expect(isEligibleToday('starter', 2)).toBe(true);   // Tue
    expect(isEligibleToday('starter', 3)).toBe(false);  // Wed
    expect(isEligibleToday('starter', 4)).toBe(true);   // Thu
    expect(isEligibleToday('starter', 5)).toBe(false);  // Fri
    expect(isEligibleToday('starter', 6)).toBe(false);  // Sat
  });
});
