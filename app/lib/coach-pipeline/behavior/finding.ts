// ─────────────────────────────────────────────────────────────────────────────
// BehaviorFinding — one tracked behaviour, from first sighting to resolved.
//
// Pure. No AI, no network, no async. Everything here is computed from trades
// and from what the trader has told us; the model's only job downstream is to
// put it into sentences it is not allowed to add to.
//
// WHY A LIFECYCLE AND NOT A SCORE
//
// A number that goes up and down tells the trader nothing about what to do.
// A behaviour that moves detected → investigating → confirmed → experiment →
// monitoring → improved gives them a place in a process, and gives the system
// a reason to change what it says instead of repeating itself. Repetition is
// how this feature dies: the same observation, reworded, every morning, until
// it becomes furniture.
//
// THREE OCCURRENCES IS NOT A CONFIRMATION
//
// It is enough to start looking. Confirming a repeated behaviour needs a
// sample that could have shown the opposite, and a pattern that survived more
// than one stretch of the history.
// ─────────────────────────────────────────────────────────────────────────────

import { BEHAVIOR_LABELS, type BehaviorKind, type BehaviorTally } from './behaviors';
import { DIMENSION_LABELS, type ContextDimension, type TradeContext } from './context';
import { analyzeTriggers, type TriggerFinding } from './contingency';
import { measurableIn } from './experiment';
import {
  assessConfidence, explanationTier,
  CONFIRM_MIN_OCCURRENCES, CONFIRM_MIN_OPPORTUNITIES,
  INVESTIGATE_MIN_OCCURRENCES, INVESTIGATE_MIN_OPPORTUNITIES,
  type Confidence, type ConfidenceAssessment, type EvidenceFamily, type Statement,
} from './evidence';

export type FindingStatus =
  /** Seen enough to notice, not enough to discuss. */
  | 'detected'
  /** Being examined. The trader sees the fact and gets a question. */
  | 'investigating'
  /** Established as a repeated behaviour on a sample that could have said no. */
  | 'confirmed'
  /** An experiment is defined and running. */
  | 'experiment'
  /** The experiment window is filling up; measuring. */
  | 'monitoring'
  /** Target improved and no guardrail broke. */
  | 'improved'
  /** Held at the improved level past a re-check. */
  | 'resolved'
  /** No longer tracked. */
  | 'archived';

/** Trailing window for the rolling baseline. Twenty opportunities is roughly
 *  a month for an active trader — recent enough to reflect now, long enough
 *  that one session can't swing it. */
export const ROLLING_WINDOW = 20;

export interface Baselines {
  /** Rate across the entire history. Slow to move, hard to fake. */
  historicalRate: number;
  historicalN:    number;
  /** Rate across the last ROLLING_WINDOW opportunities. Moves quickly, which
   *  is what makes it useful and also what makes it unsafe alone: a good
   *  fortnight looks identical to a fixed habit. Improvement is only claimed
   *  when both agree. */
  rollingRate:    number;
  rollingN:       number;
}

/** Whether the history contains a counter-example.
 *
 *  `always` and `never` are not behavioural findings, they are shapes of the
 *  data. A behaviour that occurred on EVERY opportunity has no comparison
 *  group, so it can never produce a trigger and can never be explained — the
 *  analysis has nowhere to look. And in practice a 100% rate almost always
 *  means a field is not being filled in rather than that a habit is
 *  universal: "you never logged a confirmation" is a statement about the
 *  journal, not about the trading.
 *
 *  Left in the results, because it is worth knowing. Kept out of the primary
 *  slot, because it would sit there permanently repeating one number. */
export type Contrast = 'present' | 'always' | 'never';

export interface BehaviorFinding {
  kind:          BehaviorKind;
  label:         string;
  status:        FindingStatus;
  contrast:      Contrast;

  occurrences:   number;
  opportunities: number;
  rate:          number;
  baselines:     Baselines;

  trigger:       TriggerFinding | null;
  confidence:    Confidence;
  assessment:    ConfidenceAssessment;

  /** Ordered least to most speculative. The renderer walks them in order and
   *  stops wherever the evidence stops. */
  statements:    Statement[];
  /** Present when the data cannot answer the next question by itself. */
  question:      string | null;

  /** For choosing the one behaviour to work on. See pickPrimary. */
  priorityScore: number;
  /** Average R on the trades where it happened, minus where it didn't. Null
   *  when either side is too thin to compare. Used only for prioritising —
   *  never for deciding whether the behaviour is a mistake, which is a
   *  question about the plan and not about the outcome. */
  costPerOccurrenceR: number | null;
}

// ── baselines ───────────────────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }

export function computeBaselines(tally: BehaviorTally): Baselines {
  const order = tally.opportunityTradeIds;
  const occurred = new Set(tally.events.map(e => e.tradeId));

  const recent = order.slice(-ROLLING_WINDOW);
  const recentK = recent.filter(id => occurred.has(id)).length;

  return {
    historicalRate: order.length ? round2(tally.occurrences / order.length) : 0,
    historicalN:    order.length,
    rollingRate:    recent.length ? round2(recentK / recent.length) : 0,
    rollingN:       recent.length,
  };
}

// ── lifecycle ───────────────────────────────────────────────────────────────

/** Where a freshly computed finding sits, absent any stored history.
 *
 *  `confirmed` MEANS READY TO MEASURE, NOT READY TO EXPLAIN
 *
 *  It used to require a confidence of `medium` or better, and `medium`
 *  requires a trigger — a context the behaviour demonstrably concentrates in.
 *  So a habit the system could count perfectly well was refused a measurement
 *  window because nobody could say WHEN it happened.
 *
 *  Those are different questions and only one of them is being asked here. A
 *  measurement window compares a rate before against the same rate after; it
 *  never reads the trigger. `designExperiment` takes one only to add a clause
 *  to a sentence, and `measureExperiment` does not take one at all. The gate
 *  was borrowed from the explanation ladder and did not belong.
 *
 *  Observed on a live journal: three behaviours sat at 7-of-28, 6-of-33 and
 *  6-of-33, every one of them with a HIGH sample grade and present in both
 *  halves of the history — and none of them measurable, because their
 *  contexts came in at a corrected p of 0.31 and 0.43. The evidence for WHERE
 *  they happen is genuinely weak. The evidence that they happen is not, and
 *  that is all a window needs.
 *
 *  What the trigger still gates is untouched: `explanationTier` caps a
 *  low-confidence finding at the `observed` statement, so a behaviour
 *  confirmed under this rule can still only be reported as a count. Nothing
 *  the system SAYS gets stronger — it just starts measuring what it already
 *  counts with confidence. */
export function deriveStatus(
  tally: BehaviorTally,
  assessment: ConfidenceAssessment,
  previous?: FindingStatus,
): FindingStatus {
  // Once an experiment is under way the lifecycle is driven by measurement,
  // not by recounting — otherwise a single new occurrence would drag a
  // behaviour back to 'investigating' mid-experiment and lose the window.
  if (previous === 'experiment' || previous === 'monitoring'
   || previous === 'improved'   || previous === 'resolved'
   || previous === 'archived') {
    return previous;
  }

  // Enough of it, spread across the history rather than bunched into one bad
  // fortnight, and common enough that ten opportunities could show it moving.
  //
  // Consistency speaks to whether there is a standing habit here at all — a
  // burst that never recurred is not worth a window. Measurability speaks to
  // whether the window could answer: below one expected occurrence in it, a
  // clean run is the ordinary outcome and proves nothing.
  //
  // The rarity test lives HERE rather than at the point the window opens, and
  // that placement is load-bearing. A behaviour left `confirmed` but unable to
  // open anything would hold the single primary slot, never produce a result,
  // and never release it — the deadlock again, wearing a new hat.
  const confirmable =
    tally.occurrences   >= CONFIRM_MIN_OCCURRENCES &&
    tally.opportunities >= CONFIRM_MIN_OPPORTUNITIES &&
    assessment.factors.consistency.passes &&
    measurableIn(tally.rate);
  if (confirmable) return 'confirmed';

  const investigable =
    tally.occurrences   >= INVESTIGATE_MIN_OCCURRENCES &&
    tally.opportunities >= INVESTIGATE_MIN_OPPORTUNITIES;
  if (investigable) return 'investigating';

  return 'detected';
}

// ── statements ──────────────────────────────────────────────────────────────

const DIMENSION_PHRASE: Record<ContextDimension, (v: string) => string> = {
  prevResult: v =>
    v === 'LOSS' ? 'אחרי עסקה מפסידה'
    : v === 'WIN' ? 'אחרי עסקה מרוויחה'
    : v === 'BE'  ? 'אחרי עסקה שנסגרה באפס'
    : 'בעסקה הראשונה של היום',
  dayPnlBefore: v =>
    v === 'down' ? 'כשהיום עד אותו רגע היה באדום'
    : v === 'up' ? 'כשהיום עד אותו רגע היה בירוק'
    : 'כשהיום עדיין היה מאוזן',
  nthOfDay:   v => (v === 'first' ? 'בעסקה הראשונה של היום' : 'בעסקאות שאחרי הראשונה'),
  session:    v => `בסשן ${v}`,
  hourBucket: v => `בשעה ${v}`,
  direction:  v => `בעסקאות ${v}`,
  setup:      v => `בסטאפ ${v}`,
  symbol:     v => `ב-${v}`,
};

function phraseTrigger(t: TriggerFinding): string {
  return DIMENSION_PHRASE[t.dimension](t.value);
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** Turn a finding into tiered sentences.
 *
 *  Each tier is only reached if the one below it holds. An explanation with
 *  no pattern under it is never emitted, and a pattern with no count under it
 *  is impossible by construction. */
export function buildStatements(
  tally: BehaviorTally,
  trigger: TriggerFinding | null,
  confidence: Confidence,
  contrast: Contrast = 'present',
): Statement[] {
  const out: Statement[] = [];
  const occurredIds = tally.events.map(e => e.tradeId);

  // No counter-example: say what that means about the data rather than
  // dressing it up as a pattern. "You did this every single time" reads as an
  // accusation, and the usual cause is an empty field.
  if (contrast === 'always') {
    out.push({
      tier: 'observed',
      text: `${BEHAVIOR_LABELS[tally.kind]}: בכל ${tally.opportunities} העסקאות, בלי יוצא דופן. אין נקודת השוואה, ולכן אי אפשר לנתח מתי זה קורה — ברוב המקרים זה מעיד על שדה שלא מתמלא ולא על הרגל.`,
      tradeIds: occurredIds,
    });
    return out;
  }

  // observed — always, and always first.
  out.push({
    tier: 'observed',
    text: `${BEHAVIOR_LABELS[tally.kind]}: ${tally.occurrences} מתוך ${tally.opportunities} העסקאות שבהן זה היה יכול לקרות.`,
    tradeIds: occurredIds,
  });

  if (!trigger || trigger.strength === 'weak') return out;

  // supported — WHEN it concentrates. Both rates, because one without the
  // other is a number without a comparison.
  out.push({
    tier: 'supported',
    text: `זה מרוכז ${phraseTrigger(trigger)}: ${pct(trigger.withRate)} מהמקרים שם, מול ${pct(trigger.withoutRate)} בשאר.`,
    tradeIds: occurredIds,
  });

  // possible — a candidate reading, and only ever a candidate.
  const tier = explanationTier(confidence);
  if (tier === 'possible') {
    out.push({
      tier: 'possible',
      text: `ייתכן ש${DIMENSION_LABELS[trigger.dimension]} משפיע על ההחלטה הזו. הנתונים מראים את הקשר, לא את הסיבה.`,
      tradeIds: occurredIds,
    });
  }

  return out;
}

// ── questions ───────────────────────────────────────────────────────────────

/** The question to ask when the data has gone as far as it can.
 *
 *  Tied to the specific evidence, never "why do you think you do this?" — a
 *  generic question gets a generic answer and teaches the trader that the
 *  system isn't really looking. */
export function buildQuestion(
  tally: BehaviorTally,
  trigger: TriggerFinding | null,
): string | null {
  if (tally.occurrences < INVESTIGATE_MIN_OCCURRENCES) return null;

  if (trigger && trigger.strength !== 'weak') {
    return `זה קורה בעיקר ${phraseTrigger(trigger)} — ${trigger.withK} מתוך ${trigger.withN}. מה שונה בהחלטה שלך ברגעים האלה?`;
  }

  const label = BEHAVIOR_LABELS[tally.kind];
  return `${label} חזר ${tally.occurrences} פעמים, ועדיין לא ברור מתי. בפעם האחרונה שזה קרה — מה גרם לך להחליט ככה?`;
}

// ── assembly ────────────────────────────────────────────────────────────────

export interface BuildFindingOptions {
  /** Status from the last run, so an experiment in flight isn't recomputed
   *  back to 'investigating'. */
  previousStatus?: FindingStatus;
  /** Sources beyond trade telemetry — a notebook passage that matches, an
   *  answer the trader gave. These are what let a finding reach `high`. */
  extraFamilies?: EvidenceFamily[];
  /** Average R by trade id, for the cost estimate. Optional: without it the
   *  finding is still complete, just unranked by cost. */
  rByTradeId?: Map<string, number | null>;
}

/** Average R where it happened minus where it didn't.
 *
 *  Prioritisation only. Whether a behaviour is a departure from plan is
 *  decided by the detector, on the plan; this is about which departure to
 *  spend the trader's attention on first. */
function costPerOccurrence(
  tally: BehaviorTally,
  rById?: Map<string, number | null>,
): number | null {
  if (!rById) return null;
  const occurred = new Set(tally.events.map(e => e.tradeId));
  const withR: number[] = [];
  const withoutR: number[] = [];
  for (const id of tally.opportunityTradeIds) {
    const r = rById.get(id);
    if (r == null) continue;
    (occurred.has(id) ? withR : withoutR).push(r);
  }
  if (withR.length < 2 || withoutR.length < 2) return null;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return round2(mean(withR) - mean(withoutR));
}

const CONFIDENCE_WEIGHT: Record<Confidence, number> = {
  high: 1, medium: 0.7, low: 0.4, unknown: 0.15,
};

function contrastOf(tally: BehaviorTally): Contrast {
  if (tally.occurrences === 0) return 'never';
  if (tally.occurrences === tally.opportunities) return 'always';
  return 'present';
}

export function buildFinding(
  tally: BehaviorTally,
  contexts: Map<string, TradeContext>,
  opts: BuildFindingOptions = {},
): BehaviorFinding {
  const contrast   = contrastOf(tally);
  const trigger    = analyzeTriggers(tally, contexts)[0] ?? null;
  const assessment = assessConfidence({ tally, trigger, extraFamilies: opts.extraFamilies });
  const status     = deriveStatus(tally, assessment, opts.previousStatus);
  const cost       = costPerOccurrence(tally, opts.rByTradeId);

  // Frequency × harm × how much we trust it. A behaviour that is common but
  // costs nothing measurable ranks below a rarer one that reliably hurts —
  // and both rank below nothing at all when confidence is 'unknown'.
  const harm  = cost == null ? 1 : Math.max(0.2, Math.abs(Math.min(cost, 0)) + 0.2);
  // No counter-example, no score. Nothing here can be worked on until the
  // history contains a trade where it didn't happen.
  const score = contrast === 'present'
    ? round2(tally.occurrences * harm * CONFIDENCE_WEIGHT[assessment.level])
    : 0;

  return {
    kind:          tally.kind,
    label:         BEHAVIOR_LABELS[tally.kind],
    status,
    contrast,
    occurrences:   tally.occurrences,
    opportunities: tally.opportunities,
    rate:          tally.rate,
    baselines:     computeBaselines(tally),
    trigger,
    confidence:    assessment.level,
    assessment,
    statements:    buildStatements(tally, trigger, assessment.level, contrast),
    question:      status === 'detected' || contrast !== 'present'
                     ? null
                     : buildQuestion(tally, trigger),
    priorityScore: score,
    costPerOccurrenceR: cost,
  };
}

// ── prioritisation ──────────────────────────────────────────────────────────

/** How much better a challenger must be before it displaces the behaviour the
 *  trader is already working on. Without this the primary changes most
 *  mornings and nothing is ever worked through. */
export const PRIORITY_MARGIN = 0.2;

export interface Prioritised {
  primary:  BehaviorFinding | null;
  watching: BehaviorFinding[];
}

/** Exactly one behaviour to work on, and the rest kept quiet.
 *
 *  A trader handed five problems works on none. The others stay tracked —
 *  they keep accumulating evidence — but they do not reach the daily insight.
 *
 *  A behaviour already under experiment holds its place regardless of score:
 *  interrupting a running measurement to start a different one throws away
 *  the only thing that could have told us whether the first worked. */
export function pickPrimary(
  findings: readonly BehaviorFinding[],
  previousPrimaryKind?: BehaviorKind,
  /** When each behaviour's last measurement window closed, from `measuredAt`.
   *  Absent means never. Omitted entirely, everything ranks as never-measured,
   *  which is the correct reading of an account with no history. */
  measured: ReadonlyMap<BehaviorKind, string> = new Map(),
): Prioritised {
  // 'always' and 'never' are excluded: neither can produce a trigger, so
  // neither can ever move forward. Left as primary, one of them would occupy
  // the slot permanently and repeat a single number every morning.
  //
  // 'detected' is excluded too, and by its own definition: seen enough to
  // notice, not enough to discuss. Promoting one to primary is how a system
  // ends up presenting "1 of 4" as the thing to work on today — which is not
  // an insight, it is the absence of one wearing an insight's clothes. When
  // nothing clears the bar the honest output is no primary at all.
  const eligible = findings.filter(
    f => f.status !== 'archived' && f.status !== 'resolved'
      && f.status !== 'detected' && f.contrast === 'present',
  );
  if (!eligible.length) return { primary: null, watching: [] };

  const inFlight = eligible.find(
    f => f.kind === previousPrimaryKind
      && (f.status === 'experiment' || f.status === 'monitoring'),
  );
  if (inFlight) {
    return { primary: inFlight, watching: eligible.filter(f => f !== inFlight) };
  }

  // Readiness outranks severity, and this is the fix for a real deadlock.
  //
  // A measurement window only opens for a primary that is 'confirmed'. Ranking
  // by severity alone let an 'investigating' finding — real, but still being
  // established — take the single primary slot and hold it. Nothing could
  // start: the finding holding the slot was not ready to begin, and the
  // findings that WERE ready could not get the slot. Observed in production
  // with two confirmed behaviours sitting idle for a fortnight behind an
  // investigating one.
  //
  // Severity still decides everything WITHIN a tier. This only says that among
  // findings the system has something to say about, the ones it can actually
  // act on go first — which is the order the lifecycle already implied and
  // nobody had written down.
  // The queue: whoever was measured longest ago goes first, and anything never
  // measured goes ahead of all of them.
  //
  // Ordering by WHEN rather than by WHETHER is load-bearing. A boolean rotates
  // the slot exactly once — as soon as every behaviour has had a turn they are
  // all equal again, the tiebreak falls back to severity, and the
  // highest-scoring finding takes the slot and never gives it back. That is
  // the same deadlock, arriving one rotation later, and it is what a
  // simulation over twelve nightly runs actually produced.
  //
  // Ranked below readiness, not above it: a measured finding that can start
  // today still beats an unmeasured one that cannot. ISO timestamps compare
  // lexicographically, and the empty string sorts before all of them.
  const lastTurn = (f: BehaviorFinding) => measured.get(f.kind) ?? '';

  const ranked = [...eligible].sort(
    (a, b) =>
      readinessTier(b) - readinessTier(a)
      || lastTurn(a).localeCompare(lastTurn(b))
      || b.priorityScore - a.priorityScore
      || a.kind.localeCompare(b.kind),
  );
  const incumbent = previousPrimaryKind
    ? ranked.find(f => f.kind === previousPrimaryKind) ?? null
    : null;

  let primary = ranked[0];
  // The incumbent's grip does not survive being unable to start, and it does
  // not survive having just had its turn. A challenger that can open a window
  // today beats a sitting finding that cannot, whatever the margin says —
  // otherwise the deadlock reappears one run later — and the margin cannot be
  // used to reclaim a slot the incumbent has already spent a window on.
  if (incumbent && primary !== incumbent
      && readinessTier(primary) === readinessTier(incumbent)
      && lastTurn(primary) === lastTurn(incumbent)) {
    const needed = incumbent.priorityScore * (1 + PRIORITY_MARGIN);
    if (primary.priorityScore < needed) primary = incumbent;
  }

  return { primary, watching: ranked.filter(f => f !== primary) };
}

/** Can this finding actually start a measurement today.
 *
 *  'confirmed' is the only status the experiment branch will open a window
 *  for, so it is the only one that counts as ready. Everything else is a real
 *  finding that cannot yet be acted on. */
function readinessTier(f: BehaviorFinding): number {
  return f.status === 'confirmed' ? 1 : 0;
}

// ── exports for tests ───────────────────────────────────────────────────────
export const __internals = { costPerOccurrence, phraseTrigger };
