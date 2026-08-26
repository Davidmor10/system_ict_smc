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

/** Internal identifiers. Nobody writes these; they arrive by being copied out
 *  of the prompt, and they are wrong in a card title and in a paragraph alike. */
const LATIN_IDENTIFIERS = /\b(winRate|winrate|avgRR|profitFactor)\b/;

/** Shorthand a trader genuinely uses.
 *
 *  Wrong on a generated card, where the label should have been rendered in
 *  Hebrew — and perfectly ordinary in prose. "יחס ה-R:R הממוצע שלך" is a
 *  sentence a mentor writes, and this product's own statistics page labels the
 *  metric "יחס R:R ממוצע". Flagging it inside a weekly letter costs a retry and
 *  buys a worse letter, which is the failure this whole module is built to
 *  avoid. */
const LATIN_SHORTHAND = /\b(PnL|PF|R:R)\b/;

/** For generated labels and card titles, where either kind is a failure: the
 *  surface was supposed to render the metric in Hebrew. */
export function hasLatinMetricLabel(text: string): boolean {
  return LATIN_IDENTIFIERS.test(text) || LATIN_SHORTHAND.test(text);
}

/** For prose the trader reads as sentences.
 *
 *  Only the identifiers. The shorthand is left alone here on purpose — see
 *  LATIN_SHORTHAND above. A checker that rejects a correct Hebrew sentence is
 *  worse than no checker, because it spends the one corrective retry the
 *  surface has and then publishes whatever came back instead. */
export function hasLatinIdentifier(text: string): boolean {
  return LATIN_IDENTIFIERS.test(text);
}
