// ─────────────────────────────────────────────────────────────────────────────
// The journey — what the trader is working on, what they already changed, and
// where each behaviour stands in the process.
//
// Pure. No AI, no network, no async.
//
// WHAT IS DELIBERATELY NOT HERE: the learning-score curve.
//
// It was built, shipped, and pulled one day later. Two reasons, and both are
// worth keeping written down so it does not come back unchanged:
//
//   • It could not answer "why did it move". The score compares avgRR, profit
//     factor and the edge score between the earlier and later half of the
//     history. A trader looking at a rise wants to know which of their habits
//     changed, and those are not among its inputs — so the line was a number
//     going up, which is the definition of a vanity metric.
//
//   • The edge score it reads was, at the time, up to half neutral
//     placeholder. That is fixed now (lib/intelligence/scores.ts returns null
//     per factor and redistributes the weight), but every snapshot stored
//     before the fix still carries the old placeholders, and nothing can tell
//     them apart after the fact.
//
// The engine still computes it every night and stores it. When it can name
// what moved, it earns a surface. Until then it does not get one.
// ─────────────────────────────────────────────────────────────────────────────

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
export function journeyIsEmpty(counts: JourneyCounts): boolean {
  return counts.working === 0 && counts.changed === 0 && counts.watching === 0;
}
