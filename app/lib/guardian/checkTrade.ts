// ─────────────────────────────────────────────────────────────────────────────
// Discipline Guardian — a pure, pre-save check on a pending trade. Every warning
// it raises is backed by the trader's own numbers (a real loss count today, a
// real weak slice with a real sample size). It never fires a vague nudge and
// never blocks — it surfaces evidence so the trader decides. No LLM, no I/O.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry, Direction, BiasAlignment } from '../journal';
import { computeGroupPerformance, normSession } from '../analytics';
import { sessionLabel } from '../sessions';
import { MIN_DECIDED_FOR_CLAIM } from '../stats/evidence';
import { bonferroni, fisherExactTwoSided } from '../stats/fisher';
import { PATTERN_ALPHA } from '../analytics/patterns';

/** A slice needs at least this many DECIDED trades before it can be called a
    weak spot. The shared floor, not a local copy of it — see lib/stats/
    evidence for why both stacks read the same number. */
const MIN_SAMPLE = MIN_DECIDED_FOR_CLAIM;
/** How many percentage points below the rest of the journal a slice must sit
    before it is worth testing at all. A cheap pre-filter, not the test. */
const WORSE_BY = 10;

/** Was this slice really worse, or is it a small number wobbling?
 *
 *  THIS TEST DID NOT EXIST, and the gap alone decided. On eight decided trades
 *  one extra loss moves the rate by twelve points, so a ten-point gap is what
 *  an ordinary slice does on an ordinary week — simulated against a trader
 *  whose slices are all identical, roughly half of their saves drew a warning
 *  that some slice was "below your overall average". A warning panel that
 *  fires on half of all saves teaches the trader to close it.
 *
 *  Tested against the REST of the journal rather than against the overall
 *  rate: the slice is inside the overall figure, so comparing the two compares
 *  a group with itself and shrinks every real gap.
 *
 *  `comparisons` is how many slices this save looked at — the guardian checks
 *  two, and testing two at 5% is a 10% false-warning rate unless it is
 *  corrected. */
function reallyWorse(
  sliceWins: number, sliceLosses: number,
  restWins: number, restLosses: number,
  comparisons: number,
): boolean {
  const p = fisherExactTwoSided(sliceWins, sliceLosses, restWins, restLosses);
  return bonferroni(p, comparisons) < PATTERN_ALPHA;
}

/** Decided wins and losses in a set of trades, and in everything else. */
function splitAgainstRest(all: TradeEntry[], inSlice: (t: TradeEntry) => boolean) {
  let sw = 0, sl = 0, rw = 0, rl = 0;
  for (const t of all) {
    if (t.result !== 'WIN' && t.result !== 'LOSS') continue;
    if (inSlice(t)) { if (t.result === 'WIN') sw++; else sl++; }
    else { if (t.result === 'WIN') rw++; else rl++; }
  }
  return { sliceWins: sw, sliceLosses: sl, restWins: rw, restLosses: rl };
}

const DIRECTION_HE: Record<Direction, string> = { LONG: 'לונג', SHORT: 'שורט' };
const EMOTION_HE: Record<string, string> = {
  CALM: 'רגוע', CONFIDENT: 'בטוח', STRESSED: 'לחוץ', FOMO: 'FOMO', TIRED: 'עייף', ANGRY: 'כועס', IMPATIENT: 'חסר סבלנות',
};
const sessionHe = (key: string) => sessionLabel(key);

export interface PendingTrade {
  symbol: string;
  direction: Direction;
  /** Auto-detected session key, or null when outside tracked windows. */
  session: string | null;
  emotionalState?: string;
  biasAlignment?: BiasAlignment;
}

export type WarningSeverity = 'high' | 'caution' | 'info';

export interface GuardianWarning {
  id: string;
  severity: WarningSeverity;
  /** Hebrew, evidence-carrying — always includes the number it's based on. */
  text: string;
}

const SEVERITY_RANK: Record<WarningSeverity, number> = { high: 0, caution: 1, info: 2 };

/** Checks a pending trade against the trader's real history + today's activity.
    Returns warnings ordered most-severe first; empty when nothing concrete
    stands out. `trades` is the full local journal, `todayISO` the current day. */
export function checkTrade(pending: PendingTrade, trades: TradeEntry[], todayISO: string): GuardianWarning[] {
  const warnings: GuardianWarning[] = [];

  const overall = computeGroupPerformance(trades, 'all', 'all');
  const overallWR = overall.winRate;
  const overallDecided = overall.wins + overall.losses;

  // ── Tilt: real losses logged today ──
  const lossesToday = trades.filter(t => t.dateISO === todayISO && t.result === 'LOSS').length;
  if (lossesToday >= 3) {
    warnings.push({ id: 'tilt', severity: 'high', text: `${lossesToday} הפסדים היום — זה בדיוק הרגע שסוחרים נכנסים לטילט. שווה לשקול לעצור להיום.` });
  } else if (lossesToday === 2) {
    warnings.push({ id: 'tilt', severity: 'caution', text: `2 הפסדים היום. ודא שאתה נכנס מהסיבה הנכונה ולא כדי להחזיר.` });
  }

  // Weak-slice checks only make sense once there's a real overall baseline.
  if (overallDecided >= MIN_SAMPLE) {
    const sess = pending.session;
    // Counted before either test runs, because Bonferroni corrects for the
    // comparisons MADE, not for the ones that happened to survive.
    const comparisons =
      (sess && sess !== 'NONE' ? 1 : 0) + (pending.emotionalState ? 1 : 0);

    // ── Weak session × direction ──
    if (sess && sess !== 'NONE') {
      const inSlice = (t: TradeEntry) =>
        normSession(t.session) === normSession(sess) && t.direction === pending.direction;
      const c = splitAgainstRest(trades, inSlice);
      const n = c.sliceWins + c.sliceLosses;
      const rate = n ? (100 * c.sliceWins) / n : 0;
      if (n >= MIN_SAMPLE && rate <= overallWR - WORSE_BY
        && reallyWorse(c.sliceWins, c.sliceLosses, c.restWins, c.restLosses, comparisons)) {
        warnings.push({
          id: 'weak_session_direction',
          severity: 'caution',
          text: `${DIRECTION_HE[pending.direction]} ב${sessionHe(sess)}: ${rate.toFixed(0)}% הצלחה על ${n} עסקאות שנסגרו — מתחת לממוצע הכללי שלך (${overallWR.toFixed(0)}%).`,
        });
      }
    }

    // ── Weak emotional state ──
    if (pending.emotionalState) {
      const state = pending.emotionalState;
      const c = splitAgainstRest(trades, t => t.emotionalState === state);
      const n = c.sliceWins + c.sliceLosses;
      const rate = n ? (100 * c.sliceWins) / n : 0;
      if (n >= MIN_SAMPLE && rate <= overallWR - WORSE_BY
        && reallyWorse(c.sliceWins, c.sliceLosses, c.restWins, c.restLosses, comparisons)) {
        const label = EMOTION_HE[state] ?? state;
        warnings.push({
          id: 'weak_emotion',
          severity: 'caution',
          text: `כשנכנסת במצב "${label}": ${rate.toFixed(0)}% הצלחה על ${n} עסקאות — מתחת לממוצע הכללי שלך (${overallWR.toFixed(0)}%).`,
        });
      }
    }
  }

  // ── Counter-bias (concrete: it's against the direction on this trade) ────
  //
  // Nothing is said when no direction was recorded. There were two more notes
  // here — one for a missing declaration and one for a late one — and both
  // existed because the direction lived on the dashboard, where it could be
  // forgotten in the morning or written in at night. It is a field on this
  // form now, in front of the trader as they log the trade, so a note telling
  // them it is empty is telling them what they can already see.
  if (pending.biasAlignment === 'COUNTER') {
    warnings.push({ id: 'counter_bias', severity: 'info', text: 'העסקה הזו נגד הביאס שרשמת לעסקה.' });
  }

  return warnings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
