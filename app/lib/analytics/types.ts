// ─────────────────────────────────────────────────────────────────────────────
// Analytics Engine — shared types.
//
// The engine only ever produces numbers and facts. Nothing in this module (or
// any analyzer built on top of it) invents a conclusion — that's the AI
// explanation layer's job, and it's only allowed to phrase what's here.
// ─────────────────────────────────────────────────────────────────────────────

import type { Expectancy, Streaks, PlanVsExecution, Completeness } from './journalStats';

export type ConfidenceLevel = 'low' | 'medium' | 'high';

/** Sample-size rule: <10 relevant trades = low, 10-29 = medium, 30+ = high. */
export interface Confidence {
  level: ConfidenceLevel;
  sampleSize: number;
}

/** Aggregate performance for one slice of trades (an instrument, a session, a
    weekday, a combo like "MNQ during London", etc). The unit every analyzer
    in this engine reduces down to. */
export interface GroupPerformance {
  key: string;
  label: string;
  /** All trades in the slice, including still-OPEN ones. */
  trades: number;
  wins: number;
  losses: number;
  /** 0-100, computed over decided (WIN/LOSS) trades only. */
  winRate: number;
  totalPnl: number;
  /** Average planned reward-to-risk across trades where it's computable. */
  avgRR: number;
  /** Trades `avgRR` was averaged over, and how widely they were spread.
      A mean cannot be compared against another mean without them — see
      lib/stats/movement. Null standard deviation means fewer than two
      values, which has no spread to measure. */
  rrSample: number;
  rrStdDev: number | null;
  avgWinner: number;
  /** Positive number — average size of a loss, not signed. */
  avgLoser: number;
  /** Infinity when there are wins and zero losses. */
  profitFactor: number;
  confidence: Confidence;
}

export interface PeriodPnl {
  label: string;
  pnl: number;
}

export interface PerformanceSummary {
  totalTrades: number;
  closedTrades: number;
  /** The decided split behind `winRate`. Carried because a rate on its own
      cannot be tested: comparing one period's win rate against another's
      needs the counts, not the percentage. See intelligence/periods. */
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgRR: number;
  /** As on GroupPerformance: the mean's sample and spread, carried so one
      period's average R can be compared against another's. */
  rrSample: number;
  rrStdDev: number | null;
  profitFactor: number;
  avgWinner: number;
  avgLoser: number;
  bestPeriod: PeriodPnl | null;
  worstPeriod: PeriodPnl | null;
  confidence: Confidence;
}

export interface DirectionSummary {
  long: GroupPerformance;
  short: GroupPerformance;
}

/** How the trader actually gets out of positions, computed over closed trades
    that have real exit legs recorded (pre-multi-exit trades are excluded —
    they carry no honest exit signal). The headline is `captureRatio`: how much
    of the planned move winners actually realize. */
export interface ExitBehavior {
  sampleSize: number;
  winnerCount: number;
  /** Mean realized R ÷ mean planned R across winners. Below 1 = capturing less
      than the plan on winners (cutting them short). Null when no winner has a
      computable planned R. */
  captureRatio: number | null;
  /** Winners whose realized R fell below 60% of their own planned R. */
  winnersCutShort: number;
  /** Fraction (0-1) of the sample closed in more than one leg (scaling out). */
  partialExitRate: number;
  avgWinnerR: number;
  avgLoserR: number;
}

export interface TimeSummary {
  byHour: GroupPerformance[];
  byWeekday: GroupPerformance[];
  byWeek: GroupPerformance[];
  byMonth: GroupPerformance[];
  bestHour: GroupPerformance | null;
  worstHour: GroupPerformance | null;
  bestWeekday: GroupPerformance | null;
  worstWeekday: GroupPerformance | null;
  strongestWeek: GroupPerformance | null;
  weakestWeek: GroupPerformance | null;
  bestMonth: GroupPerformance | null;
}

export type PatternKind =
  | 'instrument+session'
  | 'session+direction'
  | 'hour+instrument'
  | 'instrument+confirmation'
  | 'confirmation+hour'
  | 'direction+hour'
  | 'instrument_best'
  | 'session_vs_overall'
  | 'emotion'
  | 'confirmation_tag'
  | 'confirmation_combo'
  | 'bias_alignment'
  | 'setup'
  | 'weekday'
  /** Trades the trader stopped to screenshot, against the ones they did not.
   *  A proxy for care, not a claim about screenshots. */
  | 'documentation'
  /** Bucketed planned reward-to-risk — am I planning targets I can reach. */
  | 'planned_rr'
  /** Written down the same day, or later. */
  | 'logging'
  /** Scheduled US release days (and the window around the release) against
   *  ordinary days. See lib/analytics/macro — the calendar is derived, not
   *  fetched, and covers only what a date rule can prove. */
  | 'macro'
  /** Trades where the trader said they kept their own rules, against the ones
   *  where they said they did not. Their verdict, not ours. */
  | 'rules'
  /** Hour of entry on its own, and model/setup on its own.
   *
   *  Both used to reach the engine only inside a pair (hour×instrument,
   *  model×hour). A trader with one instrument and one model would have lost
   *  the dimension entirely once those collapsed pairs stopped being
   *  generated, so each now stands alone. */
  | 'hour'
  | 'model';

/** One candidate fact discovered by combining dimensions. Ranked, not yet
    phrased — the AI explanation layer turns the top candidate into prose,
    using only the numbers already here. */
export interface PatternCandidate {
  id: string;
  kind: PatternKind;
  subject: Record<string, string | number>;
  metric: GroupPerformance;
  /** Overall win rate across all trades, for comparison. */
  baseline: number;
  /** metric.winRate - baseline. Used for ranking, not shown raw to the user. */
  delta: number;
  confidence: Confidence;
  /** Two-sided Fisher exact p-value: this slice's wins/losses against the
   *  trades OUTSIDE it. Not against the overall rate — the overall rate
   *  contains the slice, so comparing them compares a group with itself and
   *  shrinks every real difference toward zero. */
  pValue: number;
  /** pValue × the number of slices tested this run, capped at 1.
   *
   *  Discovery crosses instrument, session, hour, direction, model,
   *  confirmation tag, tag combination, emotion, bias, setup and weekday: on a
   *  normal history that is roughly a hundred overlapping comparisons. At a
   *  hundred comparisons, several slices reach a large win-rate gap by chance
   *  alone, every time, for every trader. The correction is what separates
   *  "this is your edge" from "this is the luckiest of a hundred coin flips". */
  pAdjusted: number;
  /** pAdjusted below the threshold AND a real sample behind it. Only these may
   *  be presented to the trader as something that works. */
  significant: boolean;
  /** The exact trades this slice selected, as a stable key.
   *
   *  Carried so that two dimensions which happen to pick the identical set can
   *  be recognised as one finding wearing two labels — which is what filled
   *  the screen with "MNQ · London", "London" and "MNQ · Turtle Soup", three
   *  cards describing the same fifteen trades. */
  signature?: string;
  /** Other subjects that selected the EXACT same trades, dropped as duplicates.
   *
   *  Kept rather than discarded because they are a finding in themselves. When
   *  every trade in a group is also the same hour, the same tag and the same
   *  emotional state, the data cannot say which of them matters — they are
   *  perfectly confounded. Showing one label alone would assert a cause the
   *  numbers cannot support; naming the others says plainly that they are
   *  inseparable in this journal. */
  alsoMatches?: Array<Record<string, string | number>>;
}

/** What the correction was computed over, carried so a surface can explain a
 *  "not yet" instead of only stating it. Without the comparison count, no
 *  consumer can work out how much more evidence a candidate would need — the
 *  threshold depends on it. */
export interface PatternRun {
  /** Distinct trade-partitions tested. This is the divisor the correction used. */
  comparisons: number;
  /** Wins and losses across the whole journal, so a group's complement can be
   *  reconstructed without re-reading the trades. */
  allWins: number;
  allLosses: number;
}

export interface FullAnalysis {
  performance: PerformanceSummary;
  instruments: GroupPerformance[];
  sessions: GroupPerformance[];
  /** Breakdown by the trader's `model` tag (their own setup name). Named
      `confirmations` for historical reasons — predates the structured
      confirmation-tag field below. */
  confirmations: GroupPerformance[];
  /** Breakdown by individual structured confirmation tag (SMT, IFVG, ...). */
  confirmationTags: GroupPerformance[];
  /** Breakdown by the exact combination of confirmation tags on a trade. */
  confirmationCombos: GroupPerformance[];
  /** Breakdown by self-reported emotional state at entry. */
  emotions: GroupPerformance[];
  /** Real exit-management behavior derived from recorded exit legs. */
  exits: ExitBehavior;
  /** What one trade is worth, decomposed. Reported alongside its parts because
      the two ways to reach the same expectancy call for opposite work. */
  expectancy: Expectancy;
  /** Current and longest runs. Breakevens break a streak rather than
      extending it. */
  streaks: Streaks;
  /** What the plan asked for against what the exits delivered, on the trades
      that recorded both. */
  planVsExecution: PlanVsExecution;
  /** How much of the record is actually filled in.
   *
   *  Carried here because it is the one block that tells a consumer what it
   *  may NOT conclude: a field logged on a fifth of trades cannot support a
   *  claim about that field, and without this the only signal of that is a
   *  quietly small sample nobody reads. */
  completeness: Completeness;
  time: TimeSummary;
  direction: DirectionSummary;
  patterns: PatternCandidate[];
  /** The shape of the run that produced `patterns`. */
  patternRun: PatternRun;
}
