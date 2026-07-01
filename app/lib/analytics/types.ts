// ─────────────────────────────────────────────────────────────────────────────
// Analytics Engine — shared types.
//
// The engine only ever produces numbers and facts. Nothing in this module (or
// any analyzer built on top of it) invents a conclusion — that's the AI
// explanation layer's job, and it's only allowed to phrase what's here.
// ─────────────────────────────────────────────────────────────────────────────

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
  winRate: number;
  totalPnl: number;
  avgRR: number;
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
}

export type PatternKind =
  | 'instrument+session'
  | 'session+direction'
  | 'hour+instrument'
  | 'instrument_best'
  | 'session_vs_overall';

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
}

export interface FullAnalysis {
  performance: PerformanceSummary;
  instruments: GroupPerformance[];
  sessions: GroupPerformance[];
  time: TimeSummary;
  direction: DirectionSummary;
  patterns: PatternCandidate[];
}
