// ─────────────────────────────────────────────────────────────────────────────
// One decision, two readers.
//
// Two surfaces need to know what the behaviour layer decides for a trader: the
// nightly run, which acts on it, and the owner preview, which shows what
// tonight's run WILL do before it does it. The preview had its own copy of the
// decision — the same detect → build → prioritise → reconcile sequence,
// written out a second time.
//
// A copy of a decision is a decision that drifts, and this one did, three
// times. It went on ranking findings by severity after the real run started
// rotating them by when each was last measured, so the preview would name one
// behaviour and the night would work on another. It kept deriving an
// experiment window from `date >= the day it opened` after the run started
// slicing by position. Nothing failed; the preview simply stopped describing
// the thing it exists to describe, which is worse, because the whole point of
// it is to be believed.
//
// So the sequence lives here, once, and both callers read it. It is pure:
// trades and stored findings in, records and transitions out. The only thing
// the two callers do differently is that one of them writes the records down.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeRow } from '../types';
import { detectBehaviors, type BehaviorTally, type BehaviorKind } from './behaviors';
import { computeHoldingStreaks, type HoldingStreak } from './holding';
import { buildContexts } from './context';
import { buildFinding, pickPrimary, ROLLING_WINDOW, type BehaviorFinding } from './finding';
import { computeGuardrails } from './guardrails';
import {
  reconcile, familiesFor, measuredAt,
  type StoredFinding, type Transition,
} from './memory';
import type { ExperimentResult } from './experiment';

/** What the layer decided about one behaviour this run. */
export interface BehaviorDecision {
  finding: BehaviorFinding;
  /** What was on record before this run. Null the first time it is seen. */
  prior:   StoredFinding | null;
  /** What memory would record. The nightly run saves it; the preview shows it. */
  record:  StoredFinding;
  transition: Transition | null;
  /** Present only on the run where a window finished and was judged. */
  measured: ExperimentResult | null;
}

export interface BehaviorRun {
  findings: BehaviorFinding[];
  /** The raw tallies the findings were built from.
   *
   *  Returned so a caller can ask which TRADES each behaviour happened on,
   *  not just how many. Two detectors reporting the same count is meaningless
   *  on its own; two detectors firing on the same trades means one act is
   *  being counted twice, and only the trade ids can tell those apart. */
  tallies:  BehaviorTally[];
  /** The one behaviour being worked on, or null when nothing clears the bar. */
  primary:  BehaviorFinding | null;
  watching: BehaviorFinding[];
  holding:  HoldingStreak[];
  /** One per finding, in the same order. */
  decisions: BehaviorDecision[];
}

/** The trades since a window opened — the same trades the verdict counts.
 *
 *  Sliced by position, because that is how the verdict counts them: cumulative
 *  opportunities now, minus cumulative opportunities when the window opened.
 *  A date filter re-derives a different set — it sweeps in whatever was
 *  already logged earlier on the opening day, and misses a trade logged late
 *  under an older date.
 *
 *  Windows opened before `tradesAtStart` existed have no position to slice
 *  from and keep the old filter; with no window at all, the trailing window
 *  is the right reading. */
function windowSlice(chronological: TradeRow[], prior: StoredFinding | null): TradeRow[] {
  const start = prior?.experimentBaseline?.tradesAtStart;
  if (start != null) return chronological.slice(start);
  const since = prior?.experimentStartedAt?.slice(0, 10);
  if (since) return chronological.filter(t => t.date >= since);
  return chronological.slice(-ROLLING_WINDOW);
}

export interface RunInput {
  /** Newest-first, as `listRecentTrades` returns them. */
  trades: readonly TradeRow[];
  stored: ReadonlyMap<BehaviorKind, StoredFinding>;
  now:    string;
}

/** Detect, build, prioritise and reconcile. Pure — no database, no model. */
export function runBehaviorLayer(input: RunInput): BehaviorRun {
  const trades = [...input.trades];
  const contexts = buildContexts(trades);
  const tallies  = detectBehaviors(trades);
  // The other side of the same tallies: what has NOT gone wrong lately.
  const holding  = computeHoldingStreaks(tallies, trades);

  const rByTradeId = new Map(trades.map(t => [t.id, t.r_multiple]));
  const findings: BehaviorFinding[] = tallies.map(t => buildFinding(t, contexts, {
    rByTradeId,
    // A finding mid-experiment must not be recomputed back to 'investigating',
    // and an answered question is the only evidence family that isn't
    // telemetry.
    previousStatus: input.stored.get(t.kind)?.status,
    extraFamilies:  familiesFor(input.stored.get(t.kind) ?? null),
  }));

  const previousPrimary = [...input.stored.values()].find(s => s.isPrimary)?.kind;
  // A queue by when each behaviour was last measured. Whoever waited longest
  // goes first; anything never measured goes ahead of all of them. Without it
  // the highest-scoring finding takes the slot back the morning after its own
  // measurement and nothing else ever runs.
  const { primary, watching } = pickPrimary(
    findings, previousPrimary, measuredAt(input.stored.values()),
  );

  // Chronological — listRecentTrades hands them back newest-first.
  const chronological = [...trades].reverse();
  const guardrailsTrailing = computeGuardrails(chronological.slice(-ROLLING_WINDOW));

  const decisions = findings.map((finding): BehaviorDecision => {
    const prior = input.stored.get(finding.kind) ?? null;
    const guardrailsNow = computeGuardrails(windowSlice(chronological, prior));
    const { record, transition, measured } = reconcile({
      stored: prior, fresh: finding, guardrailsNow, guardrailsTrailing,
      isPrimary: primary?.kind === finding.kind,
      tradeCount: chronological.length,
      now: input.now,
    });
    return { finding, prior, record, transition, measured };
  });

  return { findings, tallies, primary: primary ?? null, watching, holding, decisions };
}
