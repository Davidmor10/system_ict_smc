// ─────────────────────────────────────────────────────────────────────────────
//  Market availability — the high-level "is the market trading today" gate.
//
//  Distinct from sessions.ts (which handles intraday Asia/London/NY windows):
//  this answers the coarser question of weekday vs. weekend. Index/equity CFDs
//  are dark across the weekend, so availability is derived purely from the UTC
//  day-of-week — deterministic, timezone-independent, and trivially testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketStatus {
  isMarketOpen: boolean;
  /** Human label for the next open — e.g. "Next Session: Monday Open". */
  nextOpenLabel: string;
}

// UTC day-of-week: 0 = Sunday, 6 = Saturday.
const WEEKEND_DAYS = new Set([0, 6]);

const NEXT_OPEN_LABEL = 'Next Session: Monday Open';

/**
 * Pure market-availability check. Accepts an injectable `now` for testing;
 * defaults to the current instant. No side effects, no I/O.
 */
export function getMarketStatus(now: Date = new Date()): MarketStatus {
  const isMarketOpen = !WEEKEND_DAYS.has(now.getUTCDay());
  return { isMarketOpen, nextOpenLabel: NEXT_OPEN_LABEL };
}
