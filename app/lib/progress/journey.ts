// ─────────────────────────────────────────────────────────────────────────────
// The journey — what the trader is working on, what they already changed, and
// where it is going.
//
// Pure. No AI, no network, no async. Everything here is arithmetic and
// labelling over data three existing systems already produce; the point of the
// file is that none of it was ever shown to anyone.
//
// THE ONE TRAP THIS FILE EXISTS TO AVOID
//
// `computeLearningScore` returns exactly 50 when it has fewer than two
// snapshots to compare, and its own docstring says callers must read that as
// "cannot say yet" rather than "no improvement". A 50 from an empty history
// and a 50 from a genuinely flat trader are the same number, and drawn on the
// same axis they are the same picture — a trader would read months of standing
// still where the system has simply never had enough history to answer.
//
// So the placeholder points are identified and removed here, once, and every
// surface takes `known` from this file rather than deciding for itself.
// ─────────────────────────────────────────────────────────────────────────────

import type { ScoreSnapshot } from '../intelligence/types';

/** Snapshots that carry a real learning score.
 *
 *  The score stored on snapshot N was computed from the N-1 snapshots that
 *  preceded it, and the computation needs two. So the first two snapshots of
 *  any history carry the neutral placeholder, whatever the trader did. */
export const LEARNING_PLACEHOLDER_SNAPSHOTS = 2;

export interface TrajectoryPoint {
  at: string;
  learning: number;
  edge: number;
}

export interface Trajectory {
  /** Only the points whose learning score was actually computed. */
  points: TrajectoryPoint[];
  /** False while the history is too short to say anything. A surface must say
   *  so in words — never draw a flat line at 50 and let it speak. */
  known: boolean;
  /** The latest real learning score, or null while `known` is false. */
  latest: number | null;
  /** Movement between the first and last real point. Null when there is only
   *  one, because one point is a position and not a direction. */
  delta: number | null;
}

/** The learning-score curve, with the placeholder head removed. */
export function learningTrajectory(history: ScoreSnapshot[] | null | undefined): Trajectory {
  const all = Array.isArray(history) ? history : [];
  const points = all.slice(LEARNING_PLACEHOLDER_SNAPSHOTS).map(s => ({
    at: s.at,
    learning: s.learningScore,
    edge: s.edgeScore,
  }));
  if (points.length === 0) return { points: [], known: false, latest: null, delta: null };
  const latest = points[points.length - 1].learning;
  const delta = points.length > 1 ? latest - points[0].learning : null;
  return { points, known: true, latest, delta };
}

/** The edge-score curve. Every snapshot carries a real edge score — it is
 *  smoothed against its own previous value rather than computed from a
 *  history — so unlike the learning score it has no placeholder head. */
export function edgeTrajectory(history: ScoreSnapshot[] | null | undefined): TrajectoryPoint[] {
  const all = Array.isArray(history) ? history : [];
  return all.map(s => ({ at: s.at, learning: s.learningScore, edge: s.edgeScore }));
}

// ── The lifecycle, in words ──────────────────────────────────────────────────

/** Where a behaviour stands, in the trader's language.
 *
 *  The lifecycle is the product's whole claim to being a coach rather than a
 *  dashboard, and until now it existed only as English enum members inside the
 *  engine. A trader cannot be moved through a process they cannot see the
 *  shape of. */
export const STATUS_LABELS: Record<string, string> = {
  detected:      'זוהתה',
  investigating: 'נבדקת',
  confirmed:     'אוששה',
  experiment:    'בניסוי',
  monitoring:    'במדידה',
  improved:      'השתפרה',
  resolved:      'נסגרה',
  archived:      'לא במעקב',
};

/** The order the stepper draws them in. `archived` is deliberately absent — it
 *  is a way out of the process, not a step along it. */
export const STATUS_ORDER = [
  'detected', 'investigating', 'confirmed', 'experiment', 'monitoring', 'improved', 'resolved',
] as const;

/** Which of the three parts of the screen a behaviour belongs to. */
export type Stage = 'working' | 'changed' | 'watching';

export function stageOf(status: string): Stage {
  if (status === 'experiment' || status === 'monitoring') return 'working';
  if (status === 'improved' || status === 'resolved') return 'changed';
  return 'watching';
}

/** What an experiment concluded, in the trader's language.
 *
 *  `traded_one_problem_for_another` is spelled out rather than softened. The
 *  guardrails exist precisely to catch it, and a coach that finds it and then
 *  describes it as partial success has wasted the mechanism. */
export const VERDICT_LABELS: Record<string, string> = {
  improved:                        'השתפר',
  traded_one_problem_for_another:  'הוחלפה בעיה באחרת',
  unchanged:                       'ללא שינוי מדיד',
  insufficient_data:               'לא הצטברו מספיק הזדמנויות',
};

export interface JourneyCounts {
  /** Behaviours with a window open right now. */
  working: number;
  /** Behaviours that improved and held. The number that should grow over a year. */
  changed: number;
  /** Seen, not yet ready to act on. */
  watching: number;
  /** Behaviours that came back after being resolved. Counted separately and
   *  never folded into `changed`: a relapse is information, and hiding it
   *  inside a success count is the one thing that would make this screen
   *  dishonest. */
  relapsed: number;
}

/** The three numbers the dashboard strip shows and the page repeats.
 *
 *  Computed here rather than in either surface, so the strip can never
 *  disagree with the page it links to. */
export function countJourney(
  findings: Array<{ status: string; relapses?: number }>,
): JourneyCounts {
  const counts: JourneyCounts = { working: 0, changed: 0, watching: 0, relapsed: 0 };
  for (const f of findings) {
    // An archived behaviour is not in any of the three parts.
    if (f.status === 'archived') continue;
    counts[stageOf(f.status)] += 1;
    if ((f.relapses ?? 0) > 0) counts.relapsed += 1;
  }
  return counts;
}

/** Is there anything at all to show yet?
 *
 *  A screen about progress that renders an empty frame reads as a system that
 *  has judged the trader and found nothing. The surfaces use this to choose an
 *  explanation instead. */
export function journeyIsEmpty(counts: JourneyCounts, trajectory: Trajectory): boolean {
  return counts.working === 0 && counts.changed === 0 && counts.watching === 0 && !trajectory.known;
}
