// ─────────────────────────────────────────────────────────────────────────────
// Which portfolio the night runs for.
//
// THE DECISION THIS ENCODES
//
// A daily insight costs a model call. Generating one per portfolio per night
// multiplies that by however many accounts a trader keeps, every night,
// forever — and most of those accounts are not being traded. So two rules,
// chosen together:
//
//   1. Only the ACTIVE portfolio. The one the trader last looked at is the one
//      they care about tonight. Switching accounts means the next night's note
//      is about the new one.
//   2. Only if it has traded RECENTLY. An account left alone for a month has
//      nothing new to say and costs nothing to say it about.
//
// The trade-off is stated rather than hidden: a trader with three live
// accounts gets a note about one of them each night, not three. That is the
// price of the feature being affordable, and it is the price they chose.
// ─────────────────────────────────────────────────────────────────────────────

/** How long a portfolio may sit untraded before the night skips it. */
export const RECENT_TRADE_DAYS = 30;

export interface NightlyCandidate {
  accountId: string;
  /** ISO date of the newest trade in it, or null when it has none. */
  lastTradeDate: string | null;
}

/** Days between two ISO dates, ignoring clocks. */
function daysBetween(fromISO: string, toISO: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((ms(toISO) - ms(fromISO)) / 86_400_000);
}

export function tradedRecently(
  lastTradeDate: string | null, todayISO: string, withinDays = RECENT_TRADE_DAYS,
): boolean {
  if (!lastTradeDate) return false;
  const age = daysBetween(lastTradeDate, todayISO);
  // A future-dated trade is a clock disagreement, not a stale account.
  return age <= withinDays;
}

/** The portfolio tonight's work belongs to, or null when there is none worth
 *  spending a model call on.
 *
 *  `active` is the portfolio the trader last selected. It is preferred over
 *  every other, and dropped — rather than replaced — when it has gone quiet:
 *  running the night on a DIFFERENT account than the one they are looking at
 *  would produce a note they never asked for about a portfolio they were not
 *  thinking about. */
export function nightlyPortfolio(
  candidates: readonly NightlyCandidate[],
  activeId: string | null,
  todayISO: string,
  withinDays = RECENT_TRADE_DAYS,
): string | null {
  if (candidates.length === 0) return null;

  const active = activeId ? candidates.find(c => c.accountId === activeId) : undefined;
  if (active) return tradedRecently(active.lastTradeDate, todayISO, withinDays) ? active.accountId : null;

  // No selection recorded — a trader who has never used the switcher. Fall
  // back to the most recently traded account that still qualifies, which is
  // the one they were most plausibly working in.
  const live = candidates
    .filter(c => tradedRecently(c.lastTradeDate, todayISO, withinDays))
    .sort((a, b) => (b.lastTradeDate ?? '').localeCompare(a.lastTradeDate ?? ''));
  return live[0]?.accountId ?? null;
}
