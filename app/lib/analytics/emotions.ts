import type { TradeEntry } from '../journal';
import { computeGroupPerformance } from './metrics';
import type { GroupPerformance } from './types';

/** Performance broken down by the trader's self-reported emotional state at
    entry (CALM / FOMO / STRESSED / ...). Trades with no recorded state are
    excluded — they carry no emotion signal. Sorted by sample size so the
    states the trader is in most often lead. This is the raw material for
    emotion-vs-performance insights ("FOMO entries win 31%, calm entries 64%"). */
export function analyzeEmotions(trades: TradeEntry[]): GroupPerformance[] {
  const states = new Set<string>();
  for (const t of trades) if (t.emotionalState) states.add(t.emotionalState);
  return [...states]
    .map(state => computeGroupPerformance(trades.filter(t => t.emotionalState === state), state, state))
    .filter(g => g.trades > 0)
    .sort((a, b) => b.trades - a.trades);
}
