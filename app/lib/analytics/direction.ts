import type { TradeEntry } from '../journal';
import { computeGroupPerformance } from './metrics';
import type { DirectionSummary } from './types';

/** Long vs. short performance. */
export function analyzeDirection(trades: TradeEntry[]): DirectionSummary {
  return {
    long: computeGroupPerformance(trades.filter(t => t.direction === 'LONG'), 'LONG', 'Long'),
    short: computeGroupPerformance(trades.filter(t => t.direction === 'SHORT'), 'SHORT', 'Short'),
  };
}
