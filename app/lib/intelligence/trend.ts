import type { Trend } from './types';

/** Shared trend rule used by both the trader profile and period comparisons,
    so "improving" means the same thing everywhere. `threshold` is the minimum
    absolute change to call something more than noise. Infinity-guarded: a
    profit-factor jump to/from Infinity (zero losses) is always up/down, never
    treated as NaN. */
export function computeTrend(current: number, previous: number | null, threshold: number): Trend {
  if (previous === null) return 'flat';
  if (current === previous) return 'flat';
  if (!Number.isFinite(current) && !Number.isFinite(previous)) return 'flat';
  if (!Number.isFinite(current)) return 'up';
  if (!Number.isFinite(previous)) return 'down';
  const diff = current - previous;
  if (Math.abs(diff) < threshold) return 'flat';
  return diff > 0 ? 'up' : 'down';
}
