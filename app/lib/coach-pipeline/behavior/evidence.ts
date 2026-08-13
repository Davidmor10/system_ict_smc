// ─────────────────────────────────────────────────────────────────────────────
// Evidence tiers and the confidence model.
//
// Pure. No AI, no network, no async.
//
// Two jobs, and they exist because the same failure ends the product either
// way: the system says something confident, the trader knows it isn't true,
// and every accurate thing it ever says afterwards is discounted.
//
// TIERS
//
// Every statement carries the strength of what stands behind it, and the tier
// governs the language. The boundary that matters most is between `supported`
// and `possible`, because it is the boundary between "these trades cluster
// here" and "this is why" — and nothing in trade data can cross it. A
// correlation is never rendered as a cause. The tier is a field, not a
// suggestion; the prompt reads it and the phrasing follows from it.
//
// CONFIDENCE
//
// Four factors, and all four have to clear a floor for `high`. Counting
// supporting signals is not enough: five signals drawn from one dataset are
// one signal counted five times.
//
//   sample        enough opportunities, and enough of them occurrences
//   effect        the split is large and survives the correction
//   independence  the evidence comes from genuinely different SOURCES
//   consistency   it holds across time, not inside one bad week
//
// Independence is the strict one, and deliberately so. Session and symbol
// both come from trade telemetry; agreeing with each other tells us nothing
// new. Trade telemetry alone therefore caps at `medium` — reaching `high`
// requires the trader's own voice: their rule verdict, something they wrote,
// or an answer they gave.
// ─────────────────────────────────────────────────────────────────────────────

import type { BehaviorTally } from './behaviors';
import type { TriggerFinding } from './contingency';
import { MIN_DECIDED_FOR_CLAIM, MIN_DECIDED_FOR_CONFIRMED } from '../../stats/evidence';

// ── Tiers ───────────────────────────────────────────────────────────────────

export type EvidenceTier =
  /** A fact in the data. Countable, checkable, not open to interpretation. */
  | 'observed'
  /** A pattern that survived the sample floors and the significance test.
   *  Still a description of WHEN, never of WHY. */
  | 'supported'
  /** A candidate explanation. Must be phrased as possibility and must sit on
   *  top of at least one `supported` statement — an explanation with no
   *  pattern underneath it is a guess wearing a hedge. */
  | 'possible'
  /** Not enough to say anything. Produces a question, not a sentence. */
  | 'unknown';

export interface Statement {
  tier: EvidenceTier;
  /** Hebrew, evidence-first, no diagnosis. */
  text: string;
  /** The trades this rests on. Required for every tier except `unknown`:
   *  a claim the trader cannot open and inspect is an oracle, and an oracle
   *  can only be believed or abandoned — never corrected. */
  tradeIds: string[];
}

// ── Confidence ──────────────────────────────────────────────────────────────

export type Confidence = 'high' | 'medium' | 'low' | 'unknown';

/** Where a piece of evidence came from. Two findings from the same family are
 *  one source, however differently they are phrased. */
export type EvidenceFamily =
  | 'trade_telemetry'   // prices, sizes, times — everything we compute
  | 'rule_verdict'      // the trader grading their own trade
  | 'notebook'          // something they wrote, unprompted
  | 'trader_answer';    // their reply to a targeted question

export interface ConfidenceFactors {
  /** Opportunities and occurrences behind the finding. */
  sample:       { opportunities: number; occurrences: number; passes: 'high' | 'medium' | 'none' };
  /** Strength of the conditional split, if any. */
  effect:       { strength: TriggerFinding['strength'] | 'none'; lift: number; passes: 'high' | 'medium' | 'none' };
  /** Distinct sources, not distinct numbers. */
  independence: { families: EvidenceFamily[]; count: number };
  /** Does it hold across the history, or only in one stretch of it. */
  consistency:  { windows: number; occurrencesPerWindow: number[]; passes: boolean };
}

/** Enough evidence to call it a repeated behaviour at all. */
export const CONFIRM_MIN_OCCURRENCES   = 6;
export const CONFIRM_MIN_OPPORTUNITIES = MIN_DECIDED_FOR_CONFIRMED;
/** Enough to say anything beyond "we noticed".
 *
 *  The opportunity floors come from lib/stats/evidence, shared with the
 *  pattern engine and the root-cause labeller. Two stacks analysing the same
 *  trades must not disagree about how much evidence it takes to speak — the
 *  contradiction is invisible in review and obvious on the screen. */
export const INVESTIGATE_MIN_OCCURRENCES   = 3;
export const INVESTIGATE_MIN_OPPORTUNITIES = MIN_DECIDED_FOR_CLAIM;

/** Split the opportunity timeline in half and count occurrences on each side.
 *
 *  A behaviour that appears six times in one week and never again is a bad
 *  week, not a pattern — and it is exactly the shape that a raw count cannot
 *  distinguish from a standing habit. */
export function assessConsistency(
  tally: BehaviorTally,
): ConfidenceFactors['consistency'] {
  const order = tally.opportunityTradeIds;
  const occurred = new Set(tally.events.map(e => e.tradeId));
  if (order.length < 4) {
    return { windows: 1, occurrencesPerWindow: [tally.occurrences], passes: false };
  }
  const mid = Math.floor(order.length / 2);
  const first  = order.slice(0, mid).filter(id => occurred.has(id)).length;
  const second = order.slice(mid).filter(id => occurred.has(id)).length;
  return {
    windows: 2,
    occurrencesPerWindow: [first, second],
    // Present in both halves. Not "equal in both" — a behaviour that is
    // fading is still real, and calling it inconsistent would hide exactly
    // the improvement we want to be able to see.
    passes: first > 0 && second > 0,
  };
}

function sampleGrade(occ: number, opp: number): 'high' | 'medium' | 'none' {
  if (occ >= CONFIRM_MIN_OCCURRENCES && opp >= CONFIRM_MIN_OPPORTUNITIES) return 'high';
  if (occ >= INVESTIGATE_MIN_OCCURRENCES && opp >= INVESTIGATE_MIN_OPPORTUNITIES) return 'medium';
  return 'none';
}

function effectGrade(trigger: TriggerFinding | null): ConfidenceFactors['effect'] {
  if (!trigger) return { strength: 'none', lift: 0, passes: 'none' };
  const passes =
    trigger.strength === 'strong'   ? 'high'
    : trigger.strength === 'moderate' ? 'medium'
    : 'none';
  return { strength: trigger.strength, lift: trigger.lift, passes };
}

export interface ConfidenceInput {
  tally:    BehaviorTally;
  trigger:  TriggerFinding | null;
  /** Families beyond trade telemetry that support this finding. Telemetry is
   *  added automatically — it is always present, and that is the point. */
  extraFamilies?: EvidenceFamily[];
}

export interface ConfidenceAssessment {
  level:   Confidence;
  factors: ConfidenceFactors;
  /** Why it isn't higher. Written for a human reading a log, not for the
   *  trader — but it is what stops "medium" from being a mood. */
  limitedBy: string[];
}

/** Grade a finding.
 *
 *  `high` requires every floor AND two independent sources. Nothing computed
 *  from trades alone can reach it, however clean the numbers look, because
 *  the question this feature answers is about a person and the trades are
 *  only half the record. */
export function assessConfidence(input: ConfidenceInput): ConfidenceAssessment {
  const { tally, trigger } = input;

  const families: EvidenceFamily[] = ['trade_telemetry', ...(input.extraFamilies ?? [])];
  const unique = [...new Set(families)];

  const factors: ConfidenceFactors = {
    sample: {
      opportunities: tally.opportunities,
      occurrences:   tally.occurrences,
      passes:        sampleGrade(tally.occurrences, tally.opportunities),
    },
    effect:       effectGrade(trigger),
    independence: { families: unique, count: unique.length },
    consistency:  assessConsistency(tally),
  };

  const limitedBy: string[] = [];
  if (factors.sample.passes !== 'high')  limitedBy.push('sample');
  if (factors.effect.passes !== 'high')  limitedBy.push('effect');
  if (factors.independence.count < 2)    limitedBy.push('independence');
  if (!factors.consistency.passes)       limitedBy.push('consistency');

  const level: Confidence =
    limitedBy.length === 0 ? 'high'
    : factors.sample.passes !== 'none'
      && factors.effect.passes !== 'none'
      && factors.consistency.passes ? 'medium'
    : factors.sample.passes !== 'none' ? 'low'
    : 'unknown';

  return { level, factors, limitedBy };
}

/** The tier a candidate explanation is allowed to carry.
 *
 *  Capped at `possible` no matter how strong the numbers are. Trade data can
 *  establish that a behaviour concentrates somewhere; it cannot establish
 *  why, and the gap between those is the one the product is not allowed to
 *  close on the trader's behalf. */
export function explanationTier(confidence: Confidence): EvidenceTier {
  return confidence === 'high' || confidence === 'medium' ? 'possible' : 'unknown';
}
