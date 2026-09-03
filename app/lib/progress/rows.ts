// ─────────────────────────────────────────────────────────────────────────────
// The journey, one row per behaviour.
//
// Pure. No AI, no network, no async.
//
// WHY ROWS AND NOT SECTIONS
//
// The first version grouped behaviours by stage — working / changed / watching
// — which is the right shape for an open-ended list. This list is not open
// ended: the detector taxonomy is exactly five kinds and has been since it was
// written. Grouping five things into three buckets put each behaviour in one
// bucket and scattered its history into a log at the bottom of the page, so a
// trader asking "what happened with my early exits" read three places.
//
// It also made a behaviour that was never detected disappear, and that is a
// real loss: the system having looked at something and found nothing is
// information, and it is the only thing that tells a trader what the system
// actually watches.
//
// So every kind gets a row, always, including the ones that never fired.
//
// AND THE FIVE ARE NOT EVERYTHING
//
// A trader's real problem may be none of them. It already has a home — the
// rules they wrote themselves, and the tick on the trade form saying which one
// they broke. That data has been collected for weeks and never had a screen.
// It arrives here as rows of the same shape, marked as the trader's own, and
// carrying the same denominator: breaches out of the trades they graded.
//
// They are NOT given a lifecycle stage. The stages mean something specific —
// confirmed on a sample that could have said no, an experiment with
// guardrails — and none of that machinery has run on a self-reported rule. A
// row that borrowed the vocabulary without the evidence behind it would be the
// same lie as a neutral 50.
// ─────────────────────────────────────────────────────────────────────────────

import { feminine, heNum, q } from '../hebrew';
import { stageOf, type Stage } from './journey';

/** Which way a behaviour is moving, comparing the recent window against the
 *  whole history — the same pair the improvement verdict is judged on. */
export type Trend = 'improving' | 'worsening' | 'steady' | 'unknown';

/** How far apart the two rates must be before it is called movement.
 *
 *  Four points on a rate is inside the noise of a twenty-opportunity window,
 *  and a row that flickers between improving and worsening every night is a
 *  row a trader stops reading. */
const TREND_EPSILON = 0.04;

export function trendOf(
  historicalRate: number | null | undefined,
  rollingRate: number | null | undefined,
  rollingN: number | null | undefined,
): Trend {
  if (historicalRate == null || rollingRate == null) return 'unknown';
  // A rolling window with almost nothing in it is not a direction.
  if ((rollingN ?? 0) < 5) return 'unknown';
  const diff = rollingRate - historicalRate;
  if (Math.abs(diff) < TREND_EPSILON) return 'steady';
  // The rate is of a mistake, so down is better.
  return diff < 0 ? 'improving' : 'worsening';
}

/** The wording matters more than it looks.
 *
 *  'steady' is printed beside the two rates it was computed from, so a row
 *  reading "18% → 15%" next to the words "no change" reads as a broken screen
 *  — the reader can see the numbers differ. It is not no change; it is a
 *  change too small for a twenty-opportunity window to tell from noise, and
 *  the label has to say which of those two things it means. */
export const TREND_LABELS: Record<Trend, string> = {
  improving: 'קורה פחות',
  worsening: 'קורה יותר',
  steady:    'בערך אותו דבר',
  unknown:   'אין מספיק מידע',
};

/** One line of the trader's record. */
export interface JourneyRow {
  kind: string;
  label: string;
  /** 'builtin' — one of the detectors. 'rule' — a rule the trader wrote. */
  source: 'builtin' | 'rule';
  /** Null for a kind that has never been detected, and for every rule row. */
  status: string | null;
  stage: Stage | 'undetected';
  occurrences: number;
  opportunities: number;
  /** Null when there were no opportunities to divide by. */
  rate: number | null;
  trend: Trend;
  historicalRate: number | null;
  rollingRate: number | null;
  isPrimary: boolean;
  relapses: number;
  /** The open window, when this row has one. */
  window: { what: string; done: number; of: number } | null;
  /** The judged experiment, when this row has one. */
  result: {
    verdict: string; before: number; after: number;
    historicalImproved: boolean; rollingImproved: boolean; broken: string[];
  } | null;
  firstDetectedAt: string | null;
  lastSeenAt: string | null;
  /** This row's own history, newest first. */
  events: Array<{ at: string; to: string; reason: string }>;
  /** Another behaviour firing on most of the same trades, when there is one.
   *  Two rows with identical counts are unreadable without this. */
  overlap: Overlap | null;
}

/** The status to SHOW, which is not always the status that was stored.
 *
 *  `deriveStatus` falls through to 'detected' for any kind it tallied, and a
 *  kind can be tallied with zero occurrences — it had opportunities and simply
 *  never happened. The row then read "זוהתה · 0 / 34 · 0%", which is a
 *  contradiction on its face: a behaviour that was noticed, never observed.
 *
 *  Fixed here rather than in deriveStatus on purpose. The engine's floor is
 *  load-bearing for the lifecycle — every tallied kind needs a status to
 *  transition from — and a screen is where the claim is made. */
export function presentedStatus(status: string | null | undefined, occurrences: number): string | null {
  if (!status) return null;
  return occurrences > 0 ? status : null;
}

/** The part of the record a row belongs to.
 *
 *  'undetected' is its own value rather than a missing one: a kind that has
 *  never fired is not in an early stage of the process, it is outside it. */
export function stageFor(status: string | null): Stage | 'undetected' {
  return status === null ? 'undetected' : stageOf(status);
}

/** How the rows are ordered.
 *
 *  An open window first — it is the one thing the trader is being counted on
 *  right now. Then whatever is furthest along, because a behaviour close to a
 *  verdict is more interesting than one just noticed. Undetected kinds sink,
 *  and the trader's own rules sit after the detectors, since the detectors
 *  carry evidence the rules do not. */
const STAGE_RANK: Record<string, number> = {
  experiment: 0, monitoring: 0,
  confirmed: 1, investigating: 2, detected: 3,
  improved: 4, resolved: 5,
  archived: 6,
};

export function sortRows(rows: JourneyRow[]): JourneyRow[] {
  return [...rows].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1;
    if ((a.window !== null) !== (b.window !== null)) return a.window ? -1 : 1;
    if ((a.status === null) !== (b.status === null)) return a.status === null ? 1 : -1;
    const sa = a.status ? STAGE_RANK[a.status] ?? 9 : 9;
    const sb = b.status ? STAGE_RANK[b.status] ?? 9 : 9;
    if (sa !== sb) return sa - sb;
    return b.occurrences - a.occurrences;
  });
}

/** What a row with no detection yet should say.
 *
 *  Not "no problem found" — the denominator may simply be empty, and those are
 *  different facts. The wording turns on whether there was anything to look
 *  at. */
export function undetectedNote(opportunities: number): string {
  if (opportunities === 0) return 'עוד לא היו עסקאות שמאפשרות לבדוק את זה.';
  // The hyphen belongs before a numeral and not before a word.
  const where = opportunities === 1 ? 'בהזדמנות אחת' : `ב-${heNum(opportunities)} הזדמנויות`;
  return `נבדק ${where} ולא נמצא כדפוס חוזר.`;
}

// ── the summary ─────────────────────────────────────────────────────────────
//
// The page was a table of rates. Every row had a percentage and a pair of
// percentages, and nothing on the screen was a sentence a person would read
// aloud — which is what "it feels like numbers with no summary" means when a
// trader says it.
//
// So the page opens with prose. DERIVED, NOT GENERATED: every line below is
// assembled from counts the rows already carry, so it costs no model call,
// cannot drift from the rows underneath it, and cannot invent a claim. It
// names what is happening and how much of it; it never says why, and never
// says what to do.

export interface JourneySummary {
  lines: string[];
  /** The behaviour the summary leads with, when there is one. */
  focus: string | null;
}

const CONFIRMED_WAITING = new Set(['confirmed']);
const JUST_SEEN = new Set(['detected', 'investigating']);

export function summarizeJourney(rows: JourneyRow[]): JourneySummary {
  const builtin = rows.filter(r => r.source === 'builtin');
  const rules = rows.filter(r => r.source === 'rule');

  const total = builtin.length;
  const seen = builtin.filter(r => r.status !== null).length;
  const open = builtin.find(r => r.window !== null) ?? null;
  const waiting = builtin.filter(r => r.status && CONFIRMED_WAITING.has(r.status)).length;
  const early = builtin.filter(r => r.status && JUST_SEEN.has(r.status)).length;
  const held = builtin.filter(r => r.result && r.result.verdict === 'improved').length;
  const judged = builtin.filter(r => r.result !== null).length;
  const worsening = builtin.filter(r => r.trend === 'worsening');

  const lines: string[] = [];

  // 1 · coverage. The denominator of the whole screen, said once.
  lines.push(seen === 0
    ? `המערכת בודקת ${q(total, 'התנהגות אחת', 'התנהגויות')}. אף אחת מהן לא זוהתה אצלך עדיין.`
    : `מתוך ${heNum(total)} ההתנהגויות שהמערכת בודקת, ${q(seen, 'אחת זוהתה', 'זוהו')} אצלך.`);

  // 2 · what is being counted right now.
  if (open?.window) {
    const left = Math.max(0, open.window.of - open.window.done);
    lines.push(
      `אחת נמדדת עכשיו — ${open.label}. ` +
      (open.window.done === 1
        ? `נספרה הזדמנות אחת מתוך ${heNum(open.window.of)}`
        : `נספרו ${heNum(open.window.done)} הזדמנויות מתוך ${heNum(open.window.of)}`) +
      (left > 0 ? `, ועוד ${feminine(left)} עד שנדע אם משהו השתנה.` : ', והספירה הושלמה.'),
    );
  }

  // 3 · what is ripe but untouched. This is the state his screen was in, and
  // the one the counts panel used to describe as "not ready yet".
  if (waiting > 0) {
    lines.push(waiting === 1
      ? 'אחת חוזרת על עצמה, ועוד לא התחלנו לנסות לשנות אותה.'
      : `${heNum(waiting)} חוזרות על עצמן, ועוד לא התחלנו לנסות לשנות אותן.`);
  } else if (early > 0 && !open) {
    lines.push(early === 1
      ? 'אחת ראינו, ועוד אין מספיק עסקאות כדי לדעת אם היא באמת חוזרת.'
      : `${heNum(early)} ראינו, ועוד אין מספיק עסקאות כדי לדעת אם הן באמת חוזרות.`);
  }

  // 4 · whether anything has actually been settled. Said plainly when nothing
  // has, because an absent line here reads as a quiet yes.
  lines.push(judged === 0
    ? 'עוד לא סיימנו למדוד שינוי אצלך, אז אי אפשר להגיד שמשהו כבר השתפר.'
    : held > 0
      ? (held === 1 ? 'התנהגות אחת כבר שינית, והשינוי החזיק.' : `${heNum(held)} כבר שינית, והשינוי החזיק.`)
      : 'ניסינו לשנות, אבל אף שינוי לא החזיק מספיק כדי להיחשב אמיתי.');

  // 5 · a rate that is climbing is a fact, and it belongs in the summary for
  // the same reason a fall does. No cause is offered and none is available.
  if (worsening.length === 1) {
    lines.push(`אחת קורית לאחרונה יותר מבעבר: ${worsening[0].label}.`);
  } else if (worsening.length > 1) {
    lines.push(`${heNum(worsening.length)} קורות לאחרונה יותר מבעבר.`);
  }

  // 6 · the trader's own problems, counted separately because they rest on
  // self-report and not on a detector.
  if (rules.length > 0) {
    const breaches = rules.reduce((a, r) => a + r.occurrences, 0);
    const top = [...rules].sort((a, b) => b.occurrences - a.occurrences)[0];
    lines.push(
      `בנוסף סימנת ${q(breaches, 'הפרה אחת', 'הפרות')} של ` +
      (rules.length === 1 ? 'חוק שכתבת בעצמך' : 'חוקים שכתבת בעצמך') +
      (rules.length > 1 ? `, הנפוצה: ${top.label}.` : `: ${top.label}.`),
    );
  }

  return { lines, focus: open?.label ?? null };
}

// ── the same act, counted twice ─────────────────────────────────────────────
//
// Two rows on a live journal read 6 / 34 and 6 / 34, with identical historical
// and rolling rates. That looked like a bug and was not: the detectors are
// independent, and their denominators match because both questions sit on the
// same form and get answered together.
//
// What made it unreadable is that nothing on the screen could tell the trader
// whether the two rows were about the same trades. If they are — a stop
// widened on the same trade the trader graded as a rule break, because one of
// their rules is about the stop — then the page is reporting one act twice,
// and an experiment could open on one while the other sits confirmed,
// measuring the same thing under two names.
//
// The counts cannot answer that. Only the trade ids can.

/** Occurrences shared before it is worth mentioning at all. One shared trade
 *  is a coincidence in any pair of behaviours. */
const MIN_SHARED = 2;
/** …and the shared trades must be most of THIS row's occurrences. Below that
 *  the two behaviours merely co-occur sometimes, which is ordinary and not
 *  worth a line on a screen. */
const MIN_SHARE = 2 / 3;

export interface Overlap {
  kind: string;
  label: string;
  /** Occurrences of this behaviour that are also occurrences of the other. */
  shared: number;
}

/** The behaviour whose occurrences most nearly coincide with this one's.
 *
 *  Asymmetric on purpose: a rare behaviour fully contained inside a common one
 *  is worth telling the trader about on the rare one's row, while the common
 *  one is not mostly explained by the rare one and gets no line. */
export function findOverlap(
  self: { kind: string; occurrenceIds: string[] },
  others: ReadonlyArray<{ kind: string; label: string; occurrenceIds: string[] }>,
): Overlap | null {
  if (self.occurrenceIds.length === 0) return null;
  const mine = new Set(self.occurrenceIds);

  let best: Overlap | null = null;
  for (const other of others) {
    if (other.kind === self.kind) continue;
    const shared = other.occurrenceIds.filter(id => mine.has(id)).length;
    if (shared < MIN_SHARED) continue;
    if (shared / mine.size < MIN_SHARE) continue;
    if (!best || shared > best.shared) best = { kind: other.kind, label: other.label, shared };
  }
  return best;
}
