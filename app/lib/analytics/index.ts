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
import { expectancy, streaks, planVsExecution, completeness } from './journalStats';
import type { FullAnalysis } from './types';
import type { MacroContext } from './macroHistory';

export function runFullAnalysis(trades: TradeEntry[], macro?: MacroContext): FullAnalysis {
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
    patterns: discoverPatterns(trades, macro),
    // The depth layer. These were computed for the stats page and nowhere
    // else, so every AI surface reasoned about this trader without the four
    // numbers that describe them best: what a trade is worth, what runs they
    // go on, what their exits do to their own plan, and how much of the
    // record is even there. Reading them here means one definition, shared —
    // the chat, the pattern insights and the weekly narrative can no longer
    // disagree about a trader's expectancy because they each derived it.
    expectancy:      expectancy(trades),
    streaks:         streaks(trades),
    planVsExecution: planVsExecution(trades),
    completeness:    completeness(trades),
  };
}

export { analyzePerformance } from './performance';
export { analyzeInstruments } from './instruments';
export { analyzeSessions } from './sessions';
export { analyzeConfirmations } from './confirmations';
export { analyzeConfirmationTags, analyzeConfirmationCombos, comboKey } from './confirmationTags';
export { analyzeEmotions } from './emotions';
export { analyzeExits } from './exits';
export { simulate, availableScenarios, timedTradeCount, hourScenario, ruleScenarios } from './whatif';
export type { WhatIfResult, WhatIfMetric, WhatIfScenario, ScenarioKind, RuleForWhatIf } from './whatif';
export { analyzeTime, hourOf, weekdayOf, isoWeekKey, startOfIsoWeek, addDaysISO } from './time';
export { analyzeDirection } from './direction';
export { discoverPatterns } from './patterns';
export { confidenceFor, confidenceLevelFor } from './confidence';
export { computeGroupPerformance, normSession } from './metrics';
export * from './types';

export { loadMacroContext, buildMacroContext, EMPTY_MACRO_CONTEXT } from './macroHistory';
export type { MacroContext } from './macroHistory';
