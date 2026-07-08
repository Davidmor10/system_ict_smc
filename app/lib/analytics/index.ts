// ─────────────────────────────────────────────────────────────────────────────
// Analytics Engine — single entry point.
//
// Trades → this module → structured facts. Nothing downstream (AI explanation,
// dashboard, post-trade feedback) is allowed to read raw trades directly for
// an "insight" — everything is derived from here, so every surface in the app
// agrees on what "win rate" or "confidence" means.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry } from '../journal';
import { analyzePerformance } from './performance';
import { analyzeInstruments } from './instruments';
import { analyzeSessions } from './sessions';
import { analyzeConfirmations } from './confirmations';
import { analyzeConfirmationTags, analyzeConfirmationCombos } from './confirmationTags';
import { analyzeEmotions } from './emotions';
import { analyzeExits } from './exits';
import { analyzeTime } from './time';
import { analyzeDirection } from './direction';
import { discoverPatterns } from './patterns';
import type { FullAnalysis } from './types';

export function runFullAnalysis(trades: TradeEntry[]): FullAnalysis {
  return {
    performance: analyzePerformance(trades),
    instruments: analyzeInstruments(trades),
    sessions: analyzeSessions(trades),
    confirmations: analyzeConfirmations(trades),
    confirmationTags: analyzeConfirmationTags(trades),
    confirmationCombos: analyzeConfirmationCombos(trades),
    emotions: analyzeEmotions(trades),
    exits: analyzeExits(trades),
    time: analyzeTime(trades),
    direction: analyzeDirection(trades),
    patterns: discoverPatterns(trades),
  };
}

export { analyzePerformance } from './performance';
export { analyzeInstruments } from './instruments';
export { analyzeSessions } from './sessions';
export { analyzeConfirmations } from './confirmations';
export { analyzeConfirmationTags, analyzeConfirmationCombos, comboKey } from './confirmationTags';
export { analyzeEmotions } from './emotions';
export { analyzeExits } from './exits';
export { analyzeTime, hourOf, isoWeekKey, startOfIsoWeek, addDaysISO } from './time';
export { analyzeDirection } from './direction';
export { discoverPatterns } from './patterns';
export { confidenceFor, confidenceLevelFor } from './confidence';
export { computeGroupPerformance, normSession } from './metrics';
export * from './types';
