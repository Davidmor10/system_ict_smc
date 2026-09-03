// ─────────────────────────────────────────────────────────────────────────────
// analyzeBehavior — steps 1–4 run end to end, persisted, and reduced to the
// block the prompt receives.
//
// This is the only place the behaviour layer writes. Everything under
// behavior/ is pure; this file is where the pure result meets the database and
// the model.
//
// WHAT IT HANDS THE MODEL
//
// Not trades, and not a verdict — a set of statements that are already true,
// each carrying the strength of the evidence behind it. The model's job is to
// put them into a paragraph a person will read, and it is forbidden from
// adding a fact to them. That division is the whole design: the analysis is
// deterministic and auditable, the prose is not, and nothing crosses from the
// second into the first.
//
// The most important thing it can return is nothing. `primary: null` with
// `insufficientEvidence: true` is a correct and common answer — ten trades
// cannot support a claim about a habit — and the prompt is instructed to write
// a shorter, quieter note rather than reach for something to say.
//
// Never throws. A behaviour layer that takes down the daily insight has made
// the product worse than not having one.
// ─────────────────────────────────────────────────────────────────────────────

import { listRecentTrades } from '../db/trades';
import { loadFindings, saveFinding } from '../db/behaviorFindings';
import type { BehaviorKind } from '../behavior/behaviors';
import type { HoldingStreak } from '../behavior/holding';
import { occurrenceTradeIds } from '../behavior/behaviors';
import { runBehaviorLayer } from '../behavior/run';
import type { StoredFinding } from '../behavior/memory';
import type { EvidenceTier } from '../behavior/evidence';
import { logger } from '../../logger';

/** One statement, stripped to what the prompt is allowed to see. Trade ids
 *  stay out: the model has no use for them and every extra field is another
 *  thing it might decide to mention. */
export interface BlockStatement {
  tier: EvidenceTier;
  text: string;
}

/** The verdict on a window that just finished. Only the four fields a coach
 *  would say out loud — the full ExperimentResult carries readings the model
 *  has no business narrating. */
export interface PrimaryOutcome {
  verdict:      string;
  targetBefore: number;
  targetAfter:  number;
  broken:       string[];
}

export interface BehaviorBlock {
  /** The one behaviour worth the trader's attention today, if any. */
  primary: {
    label:  string;
    status: string;
    /** How long this has been tracked. The single most useful number the
     *  memory layer adds — "three weeks" reframes a rate as a habit. */
    knownForDays: number | null;
    relapses:     number;
    statements:   BlockStatement[];
    question:     string | null;
    /** What the trader said when they last answered. Their words, not a
     *  finding — see prompt rule 20. Present so the coach can refer back to
     *  it; without that the answer box is a place to type into a void, and
     *  nobody types into one twice. */
    traderAnswer: string | null;
    experiment:   { instruction: string; windowTrades: number } | null;
    /** Present on the run where an experiment window was judged. */
    outcome: PrimaryOutcome | null;
  } | null;
  /** True when nothing cleared the bar. The prompt reads this and writes less,
   *  rather than promoting the least-thin finding to fill the space. */
  insufficientEvidence: boolean;
  /** Kinds being tracked but deliberately not raised today. Named so the model
   *  knows they exist and knows not to write about them. */
  watching: string[];
  /** What is currently going RIGHT, in process terms and never in money: runs
   *  of opportunities where a behaviour did not occur. Independent of
   *  `primary` and of `insufficientEvidence` — a trader with no finding worth
   *  raising can still be eight days into keeping their rules, and that is the
   *  most useful true thing there is to tell them that morning. */
  holding: HoldingStreak[];
}

export const EMPTY_BLOCK: BehaviorBlock = {
  primary: null,
  insufficientEvidence: true,
  watching: [],
  holding: [],
};

function daysBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export interface AnalyzeResult {
  block: BehaviorBlock;
  /** For the context snapshot on the insight row — what was tracked, and where
   *  each one stands. Lets a bad insight be traced to the state that produced
   *  it, without re-deriving a history that has since moved on. */
  snapshot: Array<{
    kind: BehaviorKind; status: string; occurrences: number; opportunities: number;
    /** The trades this behaviour happened on. Carried so a caller can tell
     *  two detectors that merely agree on a COUNT from two detectors firing
     *  on the same trades — the second means one act is being counted twice,
     *  and the counts alone cannot distinguish them. */
    occurrenceIds: string[];
  }>;
  error: string | null;
}

/** Run the layer for one trader, persist the result, and return the block.
 *
 *  `persist: false` runs everything and writes nothing — used by the preview
 *  route and by tests. */
export async function analyzeBehavior(
  clerkId: string,
  opts: { now?: string; persist?: boolean } = {},
): Promise<AnalyzeResult> {
  const now     = opts.now ?? new Date().toISOString();
  const persist = opts.persist ?? true;

  try {
    const trades = await listRecentTrades(clerkId, 500);
    if (!trades.length) return { block: EMPTY_BLOCK, snapshot: [], error: null };

    // Memory is optional in the sense that its absence must not break the run:
    // an un-migrated database should produce a first-sighting analysis, not a
    // failed insight.
    let stored = new Map<BehaviorKind, StoredFinding>();
    let memoryError: string | null = null;
    try {
      stored = await loadFindings(clerkId);
    } catch (err) {
      memoryError = err instanceof Error ? err.message : String(err);
      logger.warn('behaviour memory unavailable — running stateless', { clerkId, error: memoryError });
    }

    // The decision itself is pure and lives in behavior/run.ts, shared with
    // the preview route so the two cannot disagree about what tonight does.
    const { findings, tallies, primary, watching, holding, decisions } =
      runBehaviorLayer({ trades, stored, now });

    let primaryRecord:  StoredFinding | null = null;
    let primaryOutcome: PrimaryOutcome | null = null;

    for (const { finding, record, transition, measured } of decisions) {
      if (primary?.kind === finding.kind) {
        primaryRecord = record;
        primaryOutcome = measured
          ? {
              verdict:      measured.verdict,
              targetBefore: measured.targetBefore,
              targetAfter:  measured.targetAfter,
              broken:       measured.broken,
            }
          : null;
      }

      if (persist && !memoryError) {
        try {
          await saveFinding(clerkId, record, transition);
        } catch (err) {
          // One failed write must not cost the other three, nor the insight.
          logger.warn('behaviour finding write failed', {
            clerkId, kind: finding.kind, error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const snapshot = findings.map(f => {
      const tally = tallies.find(t => t.kind === f.kind);
      return {
        kind: f.kind, status: f.status,
        occurrences: f.occurrences, opportunities: f.opportunities,
        occurrenceIds: tally ? [...occurrenceTradeIds(tally)] : [],
      };
    });

    if (!primary) {
      return {
        block: { primary: null, insufficientEvidence: true, watching: watching.map(f => f.kind), holding },
        snapshot,
        error: memoryError,
      };
    }

    return {
      block: {
        primary: {
          label:  primary.label,
          status: primaryRecord?.status ?? primary.status,
          knownForDays: primaryRecord ? daysBetween(primaryRecord.firstDetectedAt, now) : null,
          relapses:     primaryRecord?.relapses ?? 0,
          statements:   primary.statements.map(s => ({ tier: s.tier, text: s.text })),
          // An already-answered question is not asked again; the answer is
          // evidence now, and re-asking would read as not having listened.
          question: primaryRecord?.traderAnswer ? null : (primaryRecord?.question ?? primary.question),
          traderAnswer: primaryRecord?.traderAnswer ?? null,
          experiment: primaryRecord?.experiment
            ? {
                instruction:  primaryRecord.experiment.instruction,
                windowTrades: primaryRecord.experiment.windowTrades,
              }
            : null,
          outcome: primaryOutcome,
        },
        insufficientEvidence: false,
        watching: watching.map(f => f.kind),
        holding,
      },
      snapshot,
      error: memoryError,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('behaviour analysis failed — insight continues without it', { clerkId, error: msg });
    return { block: EMPTY_BLOCK, snapshot: [], error: msg };
  }
}
