// ─────────────────────────────────────────────────────────────────────────────
// Pure selection of "today's discovery" for the dashboard — picks the single
// best CURRENT pattern already sitting in pattern_memory. Never generates
// anything itself; the service layer decides whether the pick needs a fresh
// LLM phrasing or can reuse a cached one.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConfidenceLevel } from '../analytics';
import type { PatternMemoryRow, PatternStatus } from './types';

const TIER_RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };
const STATUS_PRIORITY: Record<PatternStatus, number> = {
  strengthening: 3,
  active: 2,
  weakening: 1,
  insufficient_data: 0,
  disappeared: 0,
};

/** Pure: confidence tier desc → status priority (strengthening > active >
    weakening) → |delta| desc → most-recently-updated as the final tie-break. */
export function selectPrimaryPattern(patterns: PatternMemoryRow[]): PatternMemoryRow | null {
  const primary = patterns.filter(p => p.status === 'active' || p.status === 'strengthening');
  const eligible = primary.length > 0 ? primary : patterns.filter(p => p.status === 'weakening');
  if (eligible.length === 0) return null;

  return eligible.reduce((best, p) => {
    const tierDiff = TIER_RANK[p.currentConfidenceLevel] - TIER_RANK[best.currentConfidenceLevel];
    if (tierDiff !== 0) return tierDiff > 0 ? p : best;

    const statusDiff = STATUS_PRIORITY[p.status] - STATUS_PRIORITY[best.status];
    if (statusDiff !== 0) return statusDiff > 0 ? p : best;

    const deltaDiff = Math.abs(p.delta) - Math.abs(best.delta);
    if (deltaDiff !== 0) return deltaDiff > 0 ? p : best;

    return new Date(p.lastUpdatedAt).getTime() > new Date(best.lastUpdatedAt).getTime() ? p : best;
  });
}
