// ─────────────────────────────────────────────────────────────────────────────
// Trader Intelligence System — shared types.
//
// Everything here describes STORED, PERSISTENT facts about a trader (built
// from app/lib/analytics/*'s FullAnalysis, never invented). The AI layer only
// ever phrases what's already computed here — same discipline as the
// analytics engine itself.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConfidenceLevel, ExitBehavior, GroupPerformance, PatternKind } from '../analytics';

export type Trend = 'up' | 'down' | 'flat';

/** A scalar tracked over time against its previous stored value.
 *
 *  `sample` and `decided` are what make the NEXT comparison testable. A rate
 *  cannot be tested on its own — 60% against 50% is either a coin or a habit
 *  depending entirely on how many trades are behind each — so the snapshot
 *  carries the counts it was computed from, and the run after it reads them
 *  back. Optional because profiles written before they existed have neither;
 *  a comparison against one of those falls back to the fixed floor. */
export interface TrendValue {
  current: number;
  trend: Trend;
  /** Decided trades behind `current`. */
  sample?: number;
  /** The win/loss split behind `current`, on metrics that have one. */
  decided?: { wins: number; losses: number };
  /** How widely the values behind `current` were spread, on metrics that are
   *  a mean. Carried for the same reason `decided` is: a mean cannot be
   *  compared against another mean without it. Absent on snapshots written
   *  before it was recorded, and those fall back to the old floor. */
  spread?: number | null;
}

export interface DirectionEdge {
  edge: 'long' | 'short' | 'none';
  longWinRate: number;
  shortWinRate: number;
}

export interface ProfileChange {
  field: string;
  previousValue: string | number | null;
  currentValue: string | number | null;
}

/** Persistent, always-fully-recomputed summary of how a trader trades.
    Mirrors the `trader_profiles.profile` jsonb column. */
export interface TraderProfile {
  schemaVersion: number;
  strongestInstrument: GroupPerformance | null;
  weakestInstrument: GroupPerformance | null;
  strongestSession: GroupPerformance | null;
  weakestSession: GroupPerformance | null;
  bestHour: GroupPerformance | null;
  worstHour: GroupPerformance | null;
  direction: DirectionEdge;
  winRate: TrendValue;
  avgRR: TrendValue;
  profitFactor: TrendValue;
  /** `ratio`: legacy proxy — (avgWinner/avgLoser)/avgRR, well below 1 flags
      cutting winners short; null when avgRR isn't computable. `detail`: the
      real exit-management stats from recorded exit legs (preferred once the
      trader has multi-exit trades; sampleSize 0 means none yet). */
  exitBehavior: { ratio: number | null; detail: ExitBehavior };
  topConfirmations: GroupPerformance[];
  screenshotAvailability: { pct: number; count: number; totalClosed: number };
  /** Up to 5 most recent non-empty notes, verbatim — never synthesized. */
  notesObservations: string[];
  /** Populated from pattern_memory rows with status active/strengthening —
      composed in by the service layer, not derived from trades directly. */
  recurringConditions: PatternMemorySubjectSummary[];
  changesVsPrevious: ProfileChange[];
}

/** The slice of a PatternMemoryRow the trader profile needs to cite a
    recurring condition — deliberately smaller than the full row. */
export interface PatternMemorySubjectSummary {
  patternId: string;
  subject: Record<string, string | number>;
  status: PatternStatus;
  metric: GroupPerformance;
}

export type PatternStatus = 'active' | 'strengthening' | 'weakening' | 'disappeared' | 'insufficient_data';

export interface PatternHistoryEntry {
  at: string; // ISO timestamp
  winRate: number;
  delta: number;
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
  status: PatternStatus;
}

/** Mirrors one row of the `pattern_memory` table. */
export interface PatternMemoryRow {
  clerkId: string;
  patternId: string;
  kind: PatternKind;
  subject: Record<string, string | number>;
  status: PatternStatus;
  currentMetric: GroupPerformance;
  currentConfidenceLevel: ConfidenceLevel;
  currentSampleSize: number;
  baselineWinRate: number;
  delta: number;
  firstDetectedAt: string;
  lastSeenAt: string;
  lastUpdatedAt: string;
  consecutiveMisses: number;
  history: PatternHistoryEntry[];
  aiTitle: string | null;
  aiEvidence: string | null;
  aiAction: string | null;
  aiPhrasedStatus: PatternStatus | null;
  aiPhrasedWinRate: number | null;
  createdAt: string;
}

export interface MetricComparison {
  current: number;
  prevWeek: number | null;
  baseline4wk: number | null;
  deltaVsPrevWeek: number | null;
  deltaVsBaseline: number | null;
  trend: Trend;
}

export interface ConcentrationSlice {
  dimension: 'instrument' | 'session' | 'confirmation';
  key: string;
  label: string;
  pctOfTrades: number;
  pctOfPnl: number;
}

export interface ConcentrationCheck {
  isOverReliant: boolean;
  overRelianceSubject: ConcentrationSlice | null;
  slices: ConcentrationSlice[];
}

/** Mirrors the `weekly_ai_reports.facts` jsonb column — everything the
    narrative prompt is allowed to cite. */
export interface PeriodComparison {
  schemaVersion: number;
  winRate: MetricComparison;
  avgRR: MetricComparison;
  profitFactor: MetricComparison;
  concentration: ConcentrationCheck;
  hasPrevWeek: boolean;
  hasBaseline: boolean;
}

// ── Hypothesis Engine ───────────────────────────────────────────────────────

export type HypothesisStatus = 'active' | 'strengthening' | 'weakening' | 'invalidated' | 'insufficient_data';

/** Mirrors one row of `trader_hypotheses` — the single current synthesized
    belief about the trader's edge, built from a cluster of corroborating
    pattern_memory rows (never invented independently of them). */
export interface HypothesisState {
  clerkId: string;
  description: string | null;   // LLM-phrased, cached
  evidence: string | null;
  supportingPatternIds: string[];
  supportingMetrics: Record<string, GroupPerformance>;
  confidenceScore: number;      // 0-100
  status: HypothesisStatus;
  firstDetectedAt: string;
  lastUpdatedAt: string;
  aiPhrasedStatus: HypothesisStatus | null;
  aiPhrasedConfidence: number | null;
  createdAt: string;
}

/** A snapshot of the hypothesis at the moment a weekly report was generated —
    stored on weekly_ai_reports so the Evolution Timeline needs no extra table. */
export interface HypothesisSnapshot {
  description: string | null;
  status: HypothesisStatus;
  confidenceScore: number;
}

export interface EvolutionEntry {
  fromIsoWeek: string;
  toIsoWeek: string;
  description: string | null;
  status: HypothesisStatus;
}

// ── Root Cause Analysis ─────────────────────────────────────────────────────

export type RootCauseKind = 'exit_management' | 'entry_selectivity' | 'loss_sizing' | 'sample_variance';

/** A labeled, evidence-backed candidate explanation for why a metric moved —
    the narrative prompt verbalizes this, it never invents its own cause. */
export interface RootCauseFinding {
  kind: RootCauseKind;
  headlineMetric: 'winRate' | 'avgRR' | 'profitFactor';
  evidence: Record<string, number>;
}

// ── Edge Score / Learning Score ─────────────────────────────────────────────

export interface ScoreSnapshot {
  at: string;
  /** Null when too little of the score's definition could be measured that
   *  run. Never a neutral placeholder — see lib/intelligence/scores.ts. */
  edgeScore: number | null;
  /** Null when the history is too short to compare, or the edge score it
   *  reads was itself unmeasurable. */
  learningScore: number | null;
  winRate: number;
  avgRR: number;
  profitFactor: number;
}

// ── AI Memory ────────────────────────────────────────────────────────────────

export interface KnownFact {
  fact: string;           // durable Hebrew sentence, template-generated — never LLM-invented
  sourceField: string;    // which profile field this was derived from, for change detection
  confidence: ConfidenceLevel;
  firstStatedAt: string;
  lastConfirmedAt: string;
}
