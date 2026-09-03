// ─────────────────────────────────────────────────────────────────────────────
// The dashboard's opening paragraph — the trader, in sentences.
//
// Pure. No AI, no network, no async.
//
// WHY IT EXISTS
//
// The dashboard is supposed to be the summary and is a grid of nine tiles.
// Behaviour got prose on the journey page; the trading half never did, so the
// only account a trader has of their own performance is numbers in boxes.
// This is the other half, in the same voice.
//
// THE TREND SENTENCE IS THE DANGEROUS ONE, AND IT IS FENCED
//
// Saying "your win rate improved" compares one group of trades against
// another, and AGENTS.md makes that a rule rather than a preference: every
// such comparison goes through lib/stats/fisher.ts and is corrected for the
// number of comparisons made, and the sample floor comes from
// lib/stats/evidence.ts and not from a constant invented here.
//
// So the two halves are tested exactly, the p-value is Bonferroni-corrected
// for the one comparison actually performed, and either half below the shared
// floor returns "cannot say" — never a direction. A win rate that moved from
// 44% to 52% over seventeen trades a side is a coin, and telling a trader it
// is improvement is how a system earns their trust and then loses it.
//
// WHAT IT MAY NOT SAY: why anything happened, what works, or what to do. The
// performance half states what happened; it never names an edge. That line is
// what keeps this paragraph from contradicting the analytics stack on the
// screen next door — see docs/ai-architecture.md.
// ─────────────────────────────────────────────────────────────────────────────

import { PATTERN_ALPHA } from '../analytics/patterns';
import { canSupportClaim } from '../stats/evidence';
import { bonferroni, fisherExactTwoSided } from '../stats/fisher';

export interface TradingFacts {
  closed: number;
  wins: number;
  losses: number;
  bes: number;
  /** Wins + losses. Break-even trades decide nothing and are named, not counted. */
  decided: number;
  winRate: number | null;
  profitFactor: number | null;
  avgR: number | null;
  netPnl: number;
  startingBalance: number | null;
  tradingDays: number;
  /** Closed trades with no exit price recorded. */
  missingExit: number;
  /** Closed trades never graded against the trader's rules. */
  missingRules: number;
}

export interface HalfSplit {
  earlier: { wins: number; losses: number };
  later: { wins: number; losses: number };
}

export type WinRateShift =
  /** One of the halves is too thin for any comparison to mean anything. */
  | { kind: 'insufficient' }
  /** Tested, and the difference is inside what chance produces. */
  | { kind: 'flat'; earlier: number; later: number }
  | { kind: 'moved'; direction: 'up' | 'down'; earlier: number; later: number };

/** Did the win rate actually move, or did it wobble?
 *
 *  One comparison, tested exactly and corrected for the one comparison made.
 *  Returns a direction only when the test says so. */
export function winRateShift(split: HalfSplit): WinRateShift {
  const e = split.earlier.wins + split.earlier.losses;
  const l = split.later.wins + split.later.losses;
  if (!canSupportClaim(e) || !canSupportClaim(l)) return { kind: 'insufficient' };

  const earlier = split.earlier.wins / e;
  const later = split.later.wins / l;

  const p = bonferroni(
    fisherExactTwoSided(split.later.wins, split.later.losses, split.earlier.wins, split.earlier.losses),
    1,
  );
  if (p >= PATTERN_ALPHA) return { kind: 'flat', earlier, later };
  return { kind: 'moved', direction: later > earlier ? 'up' : 'down', earlier, later };
}

/** Split a chronological list of decided results into two equal halves. */
export function splitHalves(results: ReadonlyArray<'WIN' | 'LOSS'>): HalfSplit {
  const mid = Math.floor(results.length / 2);
  const count = (part: ReadonlyArray<'WIN' | 'LOSS'>) => ({
    wins: part.filter(r => r === 'WIN').length,
    losses: part.filter(r => r === 'LOSS').length,
  });
  return { earlier: count(results.slice(0, mid)), later: count(results.slice(mid)) };
}

export interface BehaviourFacts {
  watched: number;
  detected: number;
  open: { label: string; done: number; of: number } | null;
  changed: number;
  /** Behaviours that came back after being resolved. Counted and said
   *  separately — never folded into `changed`. "You fixed three things" while
   *  one of them returned is the one claim that would make this paragraph
   *  worth less than nothing. */
  relapsed: number;
  insufficientEvidence: boolean;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const num = (n: number) => n.toLocaleString('he-IL');

/** Count and noun, agreeing.
 *
 *  "1 עסקאות סגורות" is what a template produces and what nobody writes, and
 *  a paragraph whose whole purpose is to read like language cannot afford it.
 *  Only one and many are separated — Hebrew's dual is a nicety here, the
 *  singular is the case that reads broken. */
function q(n: number, one: string, many: string): string {
  return n === 1 ? one : `${num(n)} ${many}`;
}

/** Just the quantity, feminine — "אחת" rather than "1". */
const one = (n: number) => (n === 1 ? 'אחת' : num(n));

export function summarizeTrader(
  facts: TradingFacts,
  shift: WinRateShift,
  behaviour: BehaviourFacts | null,
): string[] {
  const lines: string[] = [];

  // 1 · the ledger. Counts and denominators, no verdict.
  if (facts.closed === 0) {
    lines.push('עוד לא נסגרה עסקה. ברגע שתסגור את הראשונה, הסיכום הזה יתחיל להתמלא.');
  } else {
    const opening = [q(facts.closed, 'עסקה סגורה אחת', 'עסקאות סגורות')];
    if (facts.tradingDays > 0) {
      opening.push(facts.tradingDays === 1 ? 'ביום מסחר אחד' : `ב-${num(facts.tradingDays)} ימי מסחר`);
    }

    // Only the outcomes that happened. "0 מפסידות" is noise in a sentence.
    const outcome: string[] = [];
    if (facts.wins > 0) outcome.push(q(facts.wins, 'אחת מנצחת', 'מנצחות'));
    if (facts.losses > 0) outcome.push(q(facts.losses, 'אחת מפסידה', 'מפסידות'));
    if (facts.bes > 0) outcome.push(q(facts.bes, 'אחת בתיקו', 'בתיקו'));
    lines.push(`${opening.join(' ')}.` + (outcome.length ? ` ${outcome.join(', ')}.` : ''));

    const second: string[] = [];
    // The rate is stated over the trades that decided, never over all of them.
    if (facts.winRate !== null) {
      second.push(`${pct(facts.winRate)} הצלחה על ${q(facts.decided, 'עסקה אחת שהוכרעה', 'עסקאות שהוכרעו')}`);
    }
    if (facts.profitFactor !== null) second.push(`יחס רווח ${facts.profitFactor.toFixed(2)}`);
    if (facts.avgR !== null) second.push(`יחס R ממוצע ${facts.avgR.toFixed(2)}`);
    if (second.length > 0) lines.push(`${second.join(', ')}.`);

    const sign = facts.netPnl < 0 ? '−' : '';
    lines.push(`רווח נקי ${sign}$${num(Math.abs(Math.round(facts.netPnl)))}` +
      (facts.startingBalance ? ` על מאזן פתיחה של $${num(facts.startingBalance)}.` : '.'));
  }

  // 2 · did it move. Fenced by the test above.
  if (facts.closed > 0) {
    if (shift.kind === 'insufficient') {
      lines.push('עוד אין מספיק עסקאות שהוכרעו כדי להשוות תקופה לתקופה.');
    } else if (shift.kind === 'flat') {
      lines.push(
        `אחוז ההצלחה עבר מ-${pct(shift.earlier)} ל-${pct(shift.later)} בין המחצית הראשונה לשנייה — ` +
        'הפרש שנמצא בתוך תחום המקריות, ולכן אינו שינוי מדיד.',
      );
    } else {
      lines.push(
        `אחוז ההצלחה ${shift.direction === 'up' ? 'עלה' : 'ירד'} מ-${pct(shift.earlier)} ל-${pct(shift.later)} ` +
        'בין המחצית הראשונה לשנייה, והפרש בגודל הזה לא מוסבר במקריות.',
      );
    }
  }

  // 3 · what is being measured about how you trade.
  if (behaviour) {
    if (behaviour.open) {
      const left = Math.max(0, behaviour.open.of - behaviour.open.done);
      lines.push(
        `נמדדת עכשיו התנהגות אחת — ${behaviour.open.label}. ` +
        (behaviour.open.done === 1 ? 'נספרה הזדמנות אחת' : `נספרו ${num(behaviour.open.done)} הזדמנויות`) +
        ` מתוך ${num(behaviour.open.of)}` +
        (left > 0 ? `, ועוד ${one(left)} עד לפסיקה.` : ', והחלון מלא.'),
      );
    } else if (behaviour.insufficientEvidence) {
      lines.push('עוד לא הצטברו מספיק עסקאות מתועדות כדי לזהות התנהגות חוזרת.');
    } else if (behaviour.detected > 0) {
      lines.push(
        `${num(behaviour.detected)} מתוך ${num(behaviour.watched)} ההתנהגויות שנבדקות זוהו אצלך, ` +
        'ואף אחת מהן לא נמדדת כרגע בחלון פתוח.',
      );
    }
    if (behaviour.changed > 0) {
      const held = behaviour.changed === 1
        ? 'התנהגות אחת כבר עברה ניסוי והחזיקה'
        : `${num(behaviour.changed)} התנהגויות כבר עברו ניסוי והחזיקו`;
      lines.push(held + (behaviour.relapsed > 0
        ? `, ו-${one(behaviour.relapsed)} חזרו אחרי שנסגרו.`
        : '.'));
    } else if (behaviour.relapsed > 0) {
      lines.push(`${q(behaviour.relapsed, 'התנהגות אחת חזרה', 'התנהגויות חזרו')} אחרי שנסגרו.`);
    }
  }

  // 4 · what the journal is missing. Last, because it is the only line the
  // trader can act on this minute — and because a summary that never names
  // its own blind spots teaches the reader that silence means complete.
  const gaps: string[] = [];
  if (facts.missingExit > 0) gaps.push(`${one(facts.missingExit)} בלי מחיר יציאה`);
  if (facts.missingRules > 0) gaps.push(`${one(facts.missingRules)} בלי תשובה על החוקים`);
  if (gaps.length > 0) {
    lines.push(`מה שחסר בתיעוד: ${gaps.join(', ')}. מה שלא תועד לא נכנס לאף חישוב כאן.`);
  }

  return lines;
}
