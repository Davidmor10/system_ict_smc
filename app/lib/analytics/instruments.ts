import type { TradeEntry } from '../journal';
import { INSTRUMENT_KEYS } from '../instruments';
import { computeGroupPerformance } from './metrics';
import type { GroupPerformance } from './types';

/** Performance broken down by instrument (MNQ/NQ/MES/ES). Instruments the
    trader has never touched are omitted rather than shown at 0. */
export function analyzeInstruments(trades: TradeEntry[]): GroupPerformance[] {
  return INSTRUMENT_KEYS
    .map(sym => computeGroupPerformance(trades.filter(t => t.symbol === sym), sym, sym))
    .filter(g => g.trades > 0);
}
