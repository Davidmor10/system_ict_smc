// ─────────────────────────────────────────────────────────────────────────────
// Discipline Guardian — a pure, pre-save check on a pending trade. Every warning
// it raises is backed by the trader's own numbers (a real loss count today, a
// real weak slice with a real sample size). It never fires a vague nudge and
// never blocks — it surfaces evidence so the trader decides. No LLM, no I/O.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry, Direction, BiasAlignment } from '../journal';
import { computeGroupPerformance, normSession } from '../analytics';
import { sessionLabel } from '../sessions';

/** A slice needs at least this many DECIDED trades before it can be called a
    weak spot — below it, it's noise, so the guardian stays silent (precision
    over nagging). */
const MIN_SAMPLE = 8;
/** How many percentage points below the trader's overall win rate a slice must
    sit before it's worth flagging. */
const WORSE_BY = 10;

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
  /** Whether a direction for this day existed BEFORE the trade.
   *
   *  'before' is the only one that makes biasAlignment meaningful. The other
   *  two are why this field exists at all: the guardian used to speak only
   *  when a trade went AGAINST a declared direction, which meant it was
   *  completely silent on the days nothing was declared — the days with no
   *  plan to go against. The one moment friction is worth most was the one
   *  moment there was none. */
  declarationState?: 'before' | 'after' | 'none';
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
    // ── Weak session × direction ──
    const sess = pending.session;
    if (sess && sess !== 'NONE') {
      const subset = trades.filter(t => normSession(t.session) === normSession(sess) && t.direction === pending.direction);
      const g = computeGroupPerformance(subset, 'slice', 'slice');
      if (g.confidence.sampleSize >= MIN_SAMPLE && g.winRate <= overallWR - WORSE_BY) {
        warnings.push({
          id: 'weak_session_direction',
          severity: 'caution',
          text: `${DIRECTION_HE[pending.direction]} ב${sessionHe(sess)}: ${g.winRate.toFixed(0)}% הצלחה על ${g.confidence.sampleSize} עסקאות שנסגרו — מתחת לממוצע הכללי שלך (${overallWR.toFixed(0)}%).`,
        });
      }
    }

    // ── Weak emotional state ──
    if (pending.emotionalState) {
      const subset = trades.filter(t => t.emotionalState === pending.emotionalState);
      const g = computeGroupPerformance(subset, 'emotion', 'emotion');
      if (g.confidence.sampleSize >= MIN_SAMPLE && g.winRate <= overallWR - WORSE_BY) {
        const label = EMOTION_HE[pending.emotionalState] ?? pending.emotionalState;
        warnings.push({
          id: 'weak_emotion',
          severity: 'caution',
          text: `כשנכנסת במצב "${label}": ${g.winRate.toFixed(0)}% הצלחה על ${g.confidence.sampleSize} עסקאות — מתחת לממוצע הכללי שלך (${overallWR.toFixed(0)}%).`,
        });
      }
    }
  }

  // ── The day's direction ───────────────────────────────────────────────────
  //
  // Three outcomes, and only the first was ever reported. A trade against a
  // declared direction is a decision the trader can defend; a trade on a day
  // with no direction at all is not a decision they ever made, and it is the
  // more common one. Neither is stated as a verdict — both name a fact and
  // stop, because the trade may still be right.
  if (pending.biasAlignment === 'COUNTER') {
    warnings.push({ id: 'counter_bias', severity: 'info', text: 'העסקה הזו נגד הביאס שהצהרת היום.' });
  } else if (pending.declarationState === 'after') {
    warnings.push({
      id: 'bias_declared_late',
      severity: 'info',
      text: 'הכיוון ליום הזה נקבע אחרי שעת העסקה, ולכן העסקה לא נמדדת מולו.',
    });
  } else if (pending.declarationState === 'none') {
    warnings.push({
      id: 'no_bias_declared',
      severity: 'info',
      text: 'לא הצהרת כיוון ליום הזה. העסקה תיספר, אבל לא מול שום תוכנית.',
    });
  }

  return warnings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
