import type { TradeEntry } from '../journal';
import { computeGroupPerformance } from './metrics';
import type { GroupPerformance } from './types';

/** Performance broken down by confirmation/setup tag (the free-text `model`
    field the trader assigns per trade, e.g. "FVG", "IFVG", "SMT + IFVG").
    Untagged trades ("Unspecified") are excluded — they carry no confirmation
    signal to analyze. Sorted by sample size so the most-used confirmations
    lead. */
export function analyzeConfirmations(trades: TradeEntry[]): GroupPerformance[] {
  const tags = new Set<string>();
  for (const t of trades) {
    if (t.model && t.model !== 'Unspecified') tags.add(t.model);
  }
  return [...tags]
    .map(tag => computeGroupPerformance(trades.filter(t => t.model === tag), tag, tag))
    .filter(g => g.trades > 0)
    .sort((a, b) => b.trades - a.trades);
}
