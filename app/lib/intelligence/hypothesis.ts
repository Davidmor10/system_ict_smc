// ─────────────────────────────────────────────────────────────────────────────
// Hypothesis Engine — synthesizes the trader's single current "edge
// hypothesis" from a cluster of corroborating pattern_memory rows (e.g.
// "Long MNQ during NY AM with IFVG confirmation"). Every run either
// strengthens, weakens, invalidates, or replaces it with a better one — never
// invents a hypothesis independent of the pattern rows it's built from.
// Pure: no I/O, no LLM. The service layer persists the result and, only when
// identity actually changes, asks the LLM to phrase description/evidence.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConfidenceLevel } from '../analytics';
import { selectPrimaryPattern } from './dashboardInsight';
import type { HypothesisState, HypothesisStatus, PatternMemoryRow } from './types';

const TIER_BASE: Record<ConfidenceLevel, number> = { low: 30, medium: 60, high: 90 };
const MAX_CORROBORATORS = 2;
const CORROBORATION_BONUS_PER_ROW = 5;
const MAX_CORROBORATION_BONUS = 10;
const STABILITY_BONUS = 10;
const STABILITY_LOOKBACK = 3;

function sharesSubjectValue(a: Record<string, string | number>, b: Record<string, string | number>): boolean {
  return Object.keys(a).some(k => k in b && a[k] === b[k]);
}

function findCorroborators(anchor: PatternMemoryRow, all: PatternMemoryRow[]): PatternMemoryRow[] {
  return all
    .filter(p => p.patternId !== anchor.patternId && (p.status === 'active' || p.status === 'strengthening'))
    .filter(p => sharesSubjectValue(p.subject, anchor.subject))
    .slice(0, MAX_CORROBORATORS);
}

function confidenceScoreFor(anchor: PatternMemoryRow, corroborators: PatternMemoryRow[]): number {
  const base = TIER_BASE[anchor.currentConfidenceLevel];
  const corroborationBonus = Math.min(corroborators.length * CORROBORATION_BONUS_PER_ROW, MAX_CORROBORATION_BONUS);
  const recent = anchor.history.slice(-STABILITY_LOOKBACK).map(h => h.status);
  const stable = recent.length >= 2 && recent.every(s => s === 'active' || s === 'strengthening');
  return Math.min(100, base + corroborationBonus + (stable ? STABILITY_BONUS : 0));
}

/** Pure: derives the current hypothesis state from this run's pattern_memory
    rows and the previously stored hypothesis (if any). */
export function deriveHypothesis(
  clerkId: string,
  patternRows: PatternMemoryRow[],
  previous: HypothesisState | null,
  nowISO: string,
): HypothesisState {
  const anchor = selectPrimaryPattern(patternRows);

  if (!anchor) {
    const hadRealHypothesis = previous !== null && previous.status !== 'insufficient_data' && previous.status !== 'invalidated';
    return {
      clerkId,
      description: hadRealHypothesis ? previous!.description : null,
      evidence: hadRealHypothesis ? previous!.evidence : null,
      supportingPatternIds: [],
      supportingMetrics: {},
      confidenceScore: 0,
      status: hadRealHypothesis ? 'invalidated' : 'insufficient_data',
      firstDetectedAt: previous?.firstDetectedAt ?? nowISO,
      lastUpdatedAt: nowISO,
      aiPhrasedStatus: hadRealHypothesis ? previous!.aiPhrasedStatus : null,
      aiPhrasedConfidence: hadRealHypothesis ? previous!.aiPhrasedConfidence : null,
      createdAt: previous?.createdAt ?? nowISO,
    };
  }

  const corroborators = findCorroborators(anchor, patternRows);
  const confidenceScore = confidenceScoreFor(anchor, corroborators);
  const sameAnchorAsBefore = previous?.supportingPatternIds[0] === anchor.patternId;
  const isFreshIdentity = !previous || previous.status === 'insufficient_data' || previous.status === 'invalidated' || !sameAnchorAsBefore;

  // anchor.status is always active/strengthening/weakening here — selectPrimaryPattern
  // never returns a disappeared/insufficient_data row — so it maps directly onto
  // HypothesisStatus when the identity is continuous; a fresh/replaced anchor is
  // instead judged on its own status (never silently inherits "strengthening" from
  // a completely different prior belief).
  const status = anchor.status as Extract<HypothesisStatus, 'active' | 'strengthening' | 'weakening'>;

  return {
    clerkId,
    description: isFreshIdentity ? null : previous!.description, // null signals the service layer to re-phrase via LLM
    evidence: isFreshIdentity ? null : previous!.evidence,
    supportingPatternIds: [anchor.patternId, ...corroborators.map(c => c.patternId)],
    supportingMetrics: Object.fromEntries([anchor, ...corroborators].map(p => [p.patternId, p.currentMetric])),
    confidenceScore,
    status,
    firstDetectedAt: isFreshIdentity ? nowISO : previous!.firstDetectedAt,
    lastUpdatedAt: nowISO,
    aiPhrasedStatus: isFreshIdentity ? null : previous!.aiPhrasedStatus,
    aiPhrasedConfidence: isFreshIdentity ? null : previous!.aiPhrasedConfidence,
    createdAt: isFreshIdentity ? nowISO : previous!.createdAt,
  };
}
