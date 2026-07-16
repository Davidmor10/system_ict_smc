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
  | 'weekday';

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
  time: TimeSummary;
  direction: DirectionSummary;
  patterns: PatternCandidate[];
}
