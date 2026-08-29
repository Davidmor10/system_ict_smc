// ─────────────────────────────────────────────────────────────────────────────
// The weekly review of the behaviour layer. Pure.
//
// WHY A WEEK IS THE RIGHT UNIT AND A DAY IS NOT
//
// The daily insight answers "what happened today". It is deliberately narrow,
// and seven of them in a row do not add up to an answer to the question the
// trader actually has, which is whether any of this is going anywhere.
//
// Nothing in the behaviour layer moves in a day. A rate needs opportunities to
// change, an experiment needs its window to fill, a relapse needs time to come
// back. A week is the shortest span over which those are visible, and the only
// span on which "you are better than you were" can be said without it being a
// good fortnight in disguise.
//
// WHAT THIS DELIBERATELY IS NOT
//
// Not a summary of the week's trading — that is the other engine's job, and it
// already does it. This answers six questions about the trader's behaviour and
// nothing else:
//
//   what improved · what came back · what is being tested
//   what got stronger or weaker · what is still unclear · what is next
//
// An empty week returns empty sections, and the caller is expected to say so
// rather than to pad. A review that always finds seven things to report is a
// review nobody reads by the third week.
// ─────────────────────────────────────────────────────────────────────────────

import type { BehaviorKind } from './behaviors';
import type { BehaviorFinding } from './finding';
import type { StoredFinding } from './memory';
import { EXPERIMENT_WINDOW } from './experiment';

/** One row from behavior_finding_events, narrowed to what a review needs. */
export interface ReviewEvent {
  kind:        string;
  at:          string;
  from_status: string | null;
  to_status:   string;
  reason:      string;
}

/** How a rate moved against the trader's own history.
 *
 *  This is the benchmark that matters: not other traders, and not an absolute
 *  standard, but the same person a month ago. The behaviour layer already
 *  computes both numbers for every finding — the rolling rate over the last
 *  twenty opportunities and the rate across the whole history — so "you today
 *  versus you before" costs nothing to state and is the only comparison the
 *  data can honestly support. */
export type Direction = 'improving' | 'worsening' | 'steady';

/** Rate points of movement before it is called movement. Below this, the two
 *  numbers are the same number with noise on top. */
export const MOVEMENT_THRESHOLD = 0.1;

export interface Movement {
  kind:      BehaviorKind;
  label:     string;
  direction: Direction;
  /** Across the whole history — slow, hard to fake. */
  historicalRate: number;
  /** The last twenty opportunities — quick to move, which is what makes it
   *  useful and also what makes it unsafe on its own. */
  rollingRate:    number;
  /** rolling − historical, in rate points. Negative is better. */
  delta:     number;
}

export interface WeeklyBehaviorReview {
  /** The window this covers. */
  from: string;
  to:   string;

  /** Reached 'improved' or 'resolved' during the window. */
  improved: Array<{ kind: BehaviorKind; label: string; at: string }>;
  /** Came back after having been closed. The most useful sentence the system
   *  has, and the one a purely forward-looking review would lose. */
  relapsed: Array<{ kind: BehaviorKind; label: string; at: string; times: number }>;
  /** Experiments in flight, and how far through their window they are. */
  underTest: Array<{
    kind: BehaviorKind; label: string; instruction: string;
    done: number; of: number;
  }>;
  /** Every tracked behaviour, and which way it is going against itself. */
  movement: Movement[];
  /** How many questions are open and unanswered.
   *
   *  THE COUNT, NOT THE QUESTIONS.
   *
   *  This used to carry the question text, and the panel printed every one of
   *  them. The daily insight asks the SAME sentences — that is where the
   *  trader answers them, in the box under the note — so the weekly review
   *  repeated, word for word, three questions already sitting on another
   *  screen. Read a fortnight in a row, near-identical lines like "…happened 7
   *  times and it is still unclear when. What made you decide that way?" stop
   *  being a question and become wallpaper.
   *
   *  It is also not this panel's job. This one answers "what moved" about
   *  emotion and discipline; asking belongs to the daily note. The count stays
   *  only because `quiet` needs to know an experiment is waiting on an answer
   *  before it calls a week empty. Nothing renders it. */
  openQuestionCount: number;
  /** Tracked, but the evidence cannot yet support saying anything. */
  stillUnclear: Array<{ kind: BehaviorKind; label: string; occurrences: number; opportunities: number }>;
  /** The one thing for next week, or null. */
  focus: { kind: BehaviorKind; label: string; status: string } | null;
  /** True when nothing in the window is worth reporting. The caller says so
   *  plainly rather than padding — see the header. */
  quiet: boolean;
}

/** Rates are floats and the threshold is a float, so a movement of EXACTLY
 *  the threshold lands a hair on the wrong side: 0.5 − 0.1 is 0.4, and
 *  0.4 − 0.5 is −0.09999999999999998, which is not ≤ −0.1. Without the
 *  epsilon a trader whose rate moved by precisely the reporting threshold is
 *  told nothing moved. */
const EPSILON = 1e-9;

function directionFor(rolling: number, historical: number): Direction {
  const delta = rolling - historical;
  if (delta <= -MOVEMENT_THRESHOLD + EPSILON) return 'improving';
  if (delta >=  MOVEMENT_THRESHOLD - EPSILON) return 'worsening';
  return 'steady';
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

export interface WeeklyReviewInput {
  /** Freshly computed this run. */
  findings: readonly BehaviorFinding[];
  /** What memory holds for each of them. */
  stored:   Map<BehaviorKind, StoredFinding>;
  /** Lifecycle events inside the window, any order. */
  events:   readonly ReviewEvent[];
  /** The behaviour currently being worked on, if any. */
  primaryKind: BehaviorKind | null;
  from: string;
  to:   string;
}

export function buildWeeklyReview(input: WeeklyReviewInput): WeeklyBehaviorReview {
  const byKind = new Map(input.findings.map(f => [f.kind, f]));
  const labelOf = (kind: string) =>
    byKind.get(kind as BehaviorKind)?.label ?? kind;

  const inWindow = input.events.filter(e => e.at >= input.from && e.at <= input.to);

  const improved = inWindow
    .filter(e => e.to_status === 'improved' || e.to_status === 'resolved')
    .map(e => ({ kind: e.kind as BehaviorKind, label: labelOf(e.kind), at: e.at }));

  // A relapse is a return to 'confirmed' from a state that had already closed
  // the behaviour out. Reading the reason text would be fragile; the
  // transition itself is unambiguous.
  const CLOSED = new Set(['improved', 'resolved', 'monitoring']);
  const relapsed = inWindow
    .filter(e => e.to_status === 'confirmed' && e.from_status !== null && CLOSED.has(e.from_status))
    .map(e => ({
      kind:  e.kind as BehaviorKind,
      label: labelOf(e.kind),
      at:    e.at,
      times: input.stored.get(e.kind as BehaviorKind)?.relapses ?? 1,
    }));

  const underTest: WeeklyBehaviorReview['underTest'] = [];
  for (const [kind, s] of input.stored) {
    if (s.status !== 'experiment' || !s.experiment || !s.experimentBaseline) continue;
    const fresh = byKind.get(kind);
    const done = fresh
      ? Math.max(0, fresh.opportunities - s.experimentBaseline.opportunitiesAtStart)
      : 0;
    underTest.push({
      kind, label: labelOf(kind),
      instruction: s.experiment.instruction,
      done: Math.min(done, s.experiment.windowTrades ?? EXPERIMENT_WINDOW),
      of:   s.experiment.windowTrades ?? EXPERIMENT_WINDOW,
    });
  }

  // Only behaviours with a real history on both numbers. A rolling rate over
  // four opportunities compared against a history of six is two readings of
  // the same handful of trades.
  const movement: Movement[] = input.findings
    .filter(f => f.contrast === 'present' && f.baselines.rollingN >= 5 && f.baselines.historicalN >= 10)
    .map(f => ({
      kind:  f.kind,
      label: f.label,
      direction: directionFor(f.baselines.rollingRate, f.baselines.historicalRate),
      historicalRate: f.baselines.historicalRate,
      rollingRate:    f.baselines.rollingRate,
      delta: round2(f.baselines.rollingRate - f.baselines.historicalRate),
    }));

  const openQuestionCount = [...input.stored.values()]
    .filter(s => s.question && !s.traderAnswer).length;

  const stillUnclear = input.findings
    .filter(f => f.status === 'detected' || f.status === 'investigating')
    .map(f => ({
      kind: f.kind, label: f.label,
      occurrences: f.occurrences, opportunities: f.opportunities,
    }));

  const primary = input.primaryKind ? byKind.get(input.primaryKind) : undefined;
  const focus = primary
    ? { kind: primary.kind, label: primary.label, status: primary.status }
    : null;

  // Quiet means: nothing moved, nothing is running, nothing is being asked.
  // Movement and "still unclear" alone do not make a week worth reporting —
  // they are the standing state, and reporting the standing state every week
  // is how a review becomes furniture.
  const quiet =
    improved.length === 0 &&
    relapsed.length === 0 &&
    underTest.length === 0 &&
    openQuestionCount === 0 &&
    movement.every(m => m.direction === 'steady');

  return {
    from: input.from, to: input.to,
    improved, relapsed, underTest, movement, openQuestionCount, stillUnclear, focus, quiet,
  };
}
