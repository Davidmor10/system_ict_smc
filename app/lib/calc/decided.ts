// ─────────────────────────────────────────────────────────────────────────────
// What counts as a win, and what counts at all.
//
// Pure. No imports — deliberately a leaf, so journal.ts, the analytics engine
// and the playbook can all share it without a cycle. Trades arrive as anything
// carrying a `result`, which is the only field the question depends on.
//
// WHY THIS IS ITS OWN FILE
//
// Five places computed a win rate, and they did not agree. Four split on the
// trade's RESULT — the word the trader chose in the form. One split on the
// SIGN OF R, and that one fed the expectancy headline.
//
// Usually identical, and that is what made it dangerous. They part on exactly
// the trades a journal is full of: a win closed at break-even after fees is a
// win by its label and neither by its sign; a trade closed a tick the right
// side of entry is a BE by its label and a win by its sign. Both numbers were
// rendered on the same screen, one in the expectancy block and one in the
// pattern cards, each describing "your journal".
//
// The label wins. The trader decides whether a trade was a win; R is a number
// the system sometimes ASSUMES — `rMultiple` falls back to the planned R when
// no realized R was recorded — and an assumption of the system's must not
// decide whether the trader's trade counts as a win.
//
// R keeps its job: how MUCH a trade returned. It just no longer votes on
// whether it won.
// ─────────────────────────────────────────────────────────────────────────────

/** The only field the split depends on. Structural so every trade shape in the
 *  codebase — journal entry, database row, pipeline row — satisfies it. */
export interface HasResult { result: string }

export interface DecidedCounts {
  wins: number;
  losses: number;
  /** Wins plus losses. NOT the trade count: an OPEN position has not finished
   *  happening, and a break-even one finished without deciding anything. */
  decided: number;
}

export function decidedCounts(trades: readonly HasResult[]): DecidedCounts {
  let wins = 0, losses = 0;
  for (const t of trades) {
    if (t.result === 'WIN') wins += 1;
    else if (t.result === 'LOSS') losses += 1;
  }
  return { wins, losses, decided: wins + losses };
}

/** Share of decided trades that won, as a fraction between 0 and 1.
 *
 *  Null when nothing has been decided — never 0. "No trades" and "never won"
 *  are different facts, and a surface that renders them the same has told the
 *  trader something false about an empty journal. Callers that want a
 *  percentage multiply at the point of display, where the unit is visible. */
export function winRateFraction(trades: readonly HasResult[]): number | null {
  const { wins, decided } = decidedCounts(trades);
  return decided > 0 ? wins / decided : null;
}

/** The same number on the 0–100 scale.
 *
 *  Both scales exist because the codebase has long-standing consumers of each,
 *  and quietly converting one of them is how a 50% became a 1% once already.
 *  What matters is that they now come from the same count. */
export function winRatePercent(trades: readonly HasResult[]): number | null {
  const f = winRateFraction(trades);
  return f == null ? null : f * 100;
}
