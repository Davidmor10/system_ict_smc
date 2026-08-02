// ─────────────────────────────────────────────────────────────────────────────
// Trade Review — the decision-analysis feature.
//
// The video is one evidence source among many. Every conclusion carries a
// confidence level AND a list of evidence pointers so the trader can audit
// every claim back to the raw material. Nothing is stated as fact unless the
// evidence supports it from at least two sources.
// ─────────────────────────────────────────────────────────────────────────────

/** Confidence in a single conclusion. Never omitted — a claim without a
    confidence level is a claim we're not allowed to make. */
export type Confidence = 'high' | 'medium' | 'low';

/** Where a piece of evidence came from. The frontend renders these as
    clickable chips so the trader can jump straight to the source. */
export type EvidenceSource =
  | 'video-frame'    // a specific moment in the video (visual)
  | 'transcript'     // something the trader said
  | 'trade-record'   // fields on the actual TradeEntry
  | 'rule'           // a rule from the user's rulebook
  | 'setup'          // a setup from the user's playbook
  | 'stats'          // aggregate statistics
  | 'pattern-memory'; // a recurring pattern from the user's history

export interface EvidencePointer {
  source: EvidenceSource;
  /** Human-readable description shown in the report ("Frame at 02:14 — FVG below entry"). */
  label: string;
  /** For video-frame / transcript, the time in seconds so the UI can jump. */
  timestampSec?: number;
  /** For rule / setup / trade-record, the id of the source object. */
  refId?: string | number;
}

/** A single conclusion in the final report. */
export interface ReviewClaim {
  /** Short, actionable statement — one sentence. */
  claim: string;
  confidence: Confidence;
  /** At least ONE evidence pointer required. For confidence:high we require ≥2 from different sources. */
  evidence: EvidencePointer[];
  /** Category — drives which report section it appears in. */
  kind: 'observation' | 'good-decision' | 'mistake' | 'rule-broken' | 'pattern-recurring';
}

/** The vision analyzer's output — pure chart-reading, no cross-referencing yet. */
export interface VisionAnalysis {
  timeframe?: string;                  // e.g. "5m", "1h" — inferred from chart context
  marketStructure: {
    bosDetected: { timestampSec: number; direction: 'bullish' | 'bearish'; confidence: Confidence }[];
    chochDetected: { timestampSec: number; direction: 'bullish' | 'bearish'; confidence: Confidence }[];
  };
  liquidity: {
    sweeps: { timestampSec: number; side: 'buy-side' | 'sell-side'; confidence: Confidence }[];
    pools:  { timestampSec: number; note: string; confidence: Confidence }[];
  };
  imbalances: {
    fvgs: { timestampSec: number; direction: 'bullish' | 'bearish'; confidence: Confidence }[];
  };
  entry: { visibleAtSec?: number; approxPriceContext?: string; confidence: Confidence } | null;
  stop:  { visibleAtSec?: number; approxPriceContext?: string; confidence: Confidence } | null;
  target:{ visibleAtSec?: number; approxPriceContext?: string; confidence: Confidence } | null;
  /** Any moment where the trader's cursor / drawing / annotation moved to a specific
      chart element — critical for cross-referencing with speech ("he said X while
      pointing to Y"). */
  pointingMoments: { timestampSec: number; what: string }[];
  /** Free-form structural notes the vision model wanted to add. */
  notes: string;
}

/** The transcript output — plain words, no interpretation. */
export interface Transcript {
  full: string;
  /** Timestamped segments so we can pin claims to specific things the trader said. */
  segments: { startSec: number; endSec: number; text: string }[];
  language: string;
}

/** Everything about the trader that matters, gathered from the app's own data. */
export interface TraderContext {
  /** The specific trade this review is attached to. */
  trade: {
    id: number;
    symbol: string;
    direction: 'LONG' | 'SHORT';
    entry: number;
    stop: number;
    target: number;
    result: 'WIN' | 'LOSS' | 'BE' | 'OPEN';
    contracts: number;
    session: string;
    setup?: string;
    model?: string;
    notes?: string;
    pnlUsd?: number | null;
    tradeR?: number | null;
    dateISO: string;
    time: string;
  };
  /** All the user's active trading rules. */
  rules: { id: string; text: string; active: boolean }[];
  /** All the user's defined setups. */
  setups: { id: string; name: string; description?: string }[];
  /** Recent aggregate stats — for the report generator to reason about "this is out of character". */
  recentStats: {
    winRate30d: number | null;
    avgR30d: number | null;
    tradesCount30d: number;
    /** Which sessions the trader normally profits in. */
    profitableSessions: string[];
  };
  /** Recurring patterns from prior reviews — the memory. */
  patterns: PatternMemoryEntry[];
}

/** One recurring pattern the system has learned about this trader. */
export interface PatternMemoryEntry {
  id: string;
  clerkId: string;
  /** e.g. "early-entry", "fomo-after-loss", "premature-exit". */
  patternKey: string;
  /** Human-readable description. */
  description: string;
  /** Number of trade reviews where this pattern was observed. */
  occurrences: number;
  /** Trade IDs where it appeared. */
  tradeIds: number[];
  firstSeenAt: number;
  lastSeenAt: number;
}

/** The final report the trader sees — nine sections. */
export interface TradeReviewReport {
  /** 1. What actually happened — factual reconstruction from the video + trade record. */
  whatHappened: ReviewClaim[];
  /** 2. Was the decision correct? — the meta-verdict. */
  decisionVerdict: {
    verdict: 'correct' | 'partially-correct' | 'incorrect' | 'unclear';
    reasoning: string;
    confidence: Confidence;
    evidence: EvidencePointer[];
  };
  /** 3. Mistakes identified. */
  mistakes: ReviewClaim[];
  /** 4. Good decisions made. */
  goodDecisions: ReviewClaim[];
  /** 5. Rules broken (linked to specific rule IDs). */
  rulesBroken: ReviewClaim[];
  /** 6. Recurring patterns that surfaced again in this trade. */
  recurringPatterns: ReviewClaim[];
  /** 7. Overall confidence in this review as a whole. */
  overallConfidence: Confidence;
  /** 8. Alternative interpretations we considered but did not confirm — surfaces them
      so the trader knows what the system saw but didn't commit to. */
  alternativeReadings: string[];
  /** 9. The ONE habit — if the trader improves it this week, biggest impact.
      Explicitly ONE. Ranked, distilled, actionable in a sentence. */
  oneThingToImprove: {
    habit: string;
    whyThisOne: string;
    howToPractice: string;
    evidence: EvidencePointer[];
  };
}

/** DB row. */
export interface TradeReviewRow {
  id: string;                          // uuid
  clerkId: string;
  tradeId: number;
  status: 'uploading' | 'analyzing' | 'done' | 'failed';
  errorMessage?: string | null;
  /** Gemini file URI while the video is being processed; null after report is ready. */
  videoFileUri?: string | null;
  /** MIME type of the uploaded video. */
  videoMime?: string | null;
  /** Duration in seconds. */
  videoDurationSec?: number | null;
  /** Full report JSON — populated once status === 'done'. */
  report?: TradeReviewReport | null;
  /** Intermediate outputs, kept for audit / re-analysis without re-uploading. */
  vision?: VisionAnalysis | null;
  transcript?: Transcript | null;
  createdAt: number;
  updatedAt: number;
}
