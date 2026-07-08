import type { TradeEntry } from '../journal';
import { computeGroupPerformance } from './metrics';
import type { GroupPerformance } from './types';

/** The exact set of confirmation tags on a trade, as a stable key. Sorted so
    [SMT, IFVG] and [IFVG, SMT] collapse to the same combo. */
export function comboKey(confirmations: string[] | undefined): string {
  return [...(confirmations ?? [])].sort().join('+');
}

/** Performance per individual confirmation tag (SMT, IFVG, ...). A trade tagged
    with several confirmations counts once in each tag's group, so this answers
    "how do I do when SMT is present at all", independent of what else was.
    Sorted by sample size. */
export function analyzeConfirmationTags(trades: TradeEntry[]): GroupPerformance[] {
  const tags = new Set<string>();
  for (const t of trades) for (const c of t.confirmations ?? []) tags.add(c);
  return [...tags]
    .map(tag => computeGroupPerformance(trades.filter(t => (t.confirmations ?? []).includes(tag)), tag, tag))
    .filter(g => g.trades > 0)
    .sort((a, b) => b.trades - a.trades);
}

/** Performance per exact confirmation combination — "IFVG+SMT" is analyzed
    separately from either tag alone, so the trader can see whether stacking
    confirmations actually helps. Trades with no confirmations are excluded.
    Sorted by sample size. */
export function analyzeConfirmationCombos(trades: TradeEntry[]): GroupPerformance[] {
  const tagged = trades.filter(t => (t.confirmations?.length ?? 0) > 0);
  const keys = new Set<string>();
  for (const t of tagged) keys.add(comboKey(t.confirmations));
  return [...keys]
    .map(key => computeGroupPerformance(tagged.filter(t => comboKey(t.confirmations) === key), key, key))
    .filter(g => g.trades > 0)
    .sort((a, b) => b.trades - a.trades);
}
