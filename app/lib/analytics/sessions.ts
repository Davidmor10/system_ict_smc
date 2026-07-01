import type { TradeEntry } from '../journal';
import { SESS } from '../sessions';
import { computeGroupPerformance, normSession } from './metrics';
import type { GroupPerformance } from './types';

/** Performance broken down by session (Asia/London/NY AM/NY PM). Sessions
    the trader has never logged are omitted. */
export function analyzeSessions(trades: TradeEntry[]): GroupPerformance[] {
  return SESS
    .map(s => computeGroupPerformance(trades.filter(t => normSession(t.session) === s.key), s.key, s.en))
    .filter(g => g.trades > 0);
}
