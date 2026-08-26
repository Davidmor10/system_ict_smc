// ─────────────────────────────────────────────────────────────────────────────
// Language guards — is this Hebrew, and is it Hebrew a person would read.
//
// Pure. No imports, so every surface that publishes prose can hold the same
// line: the pattern cards, the daily insight, the coach's answers and the
// weekly report.
//
// A model asked for Hebrew returns English often enough to matter, and returns
// Hebrew carrying English metric labels far more often than that — the second
// is the one that actually shipped, because four Latin tokens never outweigh a
// Hebrew sentence and the first guard cannot see them.
// ─────────────────────────────────────────────────────────────────────────────

/** True when a sentence is written in Latin script rather than Hebrew. Counts
 *  letters only: tickers, tags and digits are expected inside Hebrew prose and
 *  must not tip the verdict on their own. */
export function isMostlyLatin(text: string): boolean {
  const hebrew = (text.match(/[\u0590-\u05FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  // Below a dozen Latin letters there is no English sentence — only tickers,
  // tags and units ("MNQ", "NY AM", "+1.31R"), all of which belong in Hebrew
  // prose and must not be mistaken for it.
  if (latin < 12) return false;
  return latin > hebrew;
}

/** Latin metric labels that only ever reach a Hebrew sentence by being copied
 *  out of the prompt. Kept as a guard behind the prompt fix, not instead of
 *  it: a model can still reach for "PF" on its own, and one English token is
 *  the difference between a page that reads as finished and one that does
 *  not. */
const LATIN_METRIC_TOKENS = /\b(winRate|avgRR|PnL|PF|profitFactor|winrate|R:R)\b/;

/** The slice's trade ids, from the signature the pattern engine already built.
 *
 *  Tolerant on purpose: a candidate that somehow reached here without one
 *  yields an empty list, and the card simply cannot be opened. A crash on the
 *  analytics page would be a far worse outcome than a missing toggle. */
function idsFromSignature(signature: string | undefined): number[] {
  if (!signature) return [];
  return signature.split(',')
    // An empty segment must not become an id. Number('') is 0, which is finite
    // and would put a trade that does not exist into the list.
    .filter(part => part.trim() !== '')
    .map(Number)
    .filter(n => Number.isInteger(n));
}

export function hasLatinMetricLabel(text: string): boolean {
  return LATIN_METRIC_TOKENS.test(text);
}
