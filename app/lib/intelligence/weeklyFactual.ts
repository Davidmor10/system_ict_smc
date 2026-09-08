// ─────────────────────────────────────────────────────────────────────────────
// The weekly report for a week that cannot carry a conclusion.
//
// Until now such a week produced nothing at all. The service returned null
// below five closed trades and no row was ever written, so a trader who took
// four trades — a perfectly reasonable week — opened the report and found an
// explanation of why there was no report. Four trades were turned into a
// failure by the only surface that was supposed to describe them.
//
// A week is always written now. What changes with the sample is not WHETHER
// there is a report but what the report is allowed to be:
//
//   · At or above the claim floor — the model writes the letter: comparison,
//     mechanism, what it means for the edge. That path is unchanged.
//   · Below it — this module writes the report, and it is pure. Every
//     sentence is a count or a value taken straight off the trader's own
//     trades. No model, no comparison, no cause, no trend. It records the
//     week and then says, in as many words, what it cannot conclude from it
//     and why.
//
// That last part is the point and not a disclaimer. "Absent is its own
// answer" runs through this codebase; a quiet week is a fact about the week,
// not a gap in the data feed, and the honest report of a four-trade week is a
// short one that says so.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry } from '../journal';
import { decidedCounts } from '../calc/decided';

export interface FactualWeeklyReport {
  paragraphs: string[];
  /** Stored alongside the report so the row can be read back without
   *  re-deriving it. Counts only — there is nothing here to interpret. */
  facts: Record<string, unknown>;
}

const DAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** Weekday name for a `YYYY-MM-DD`, read as a calendar day rather than an
 *  instant — `new Date('2026-09-03')` is midnight UTC, which is the previous
 *  day in any negative offset and has renamed days in this codebase before. */
export function weekdayHe(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  if (!y || !m || !d) return '';
  return DAY_HE[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
}

/** "3.9" — day and month, the way a date is said out loud in Hebrew. */
export function shortDateHe(dateISO: string): string {
  const [, m, d] = dateISO.split('-').map(Number);
  return m && d ? `${d}.${m}` : dateISO;
}

/** Days elapsed in the week, counting today — 1 on the week's first day.
 *
 *  Derived from the two ISO dates the caller already holds rather than from
 *  `new Date().getDay()`, which reads the SERVER's weekday. This runs in a
 *  serverless function whose clock is UTC while the trader's week is not, and
 *  on a Sunday evening in Israel that difference is a whole week. */
export function daysIntoWeekFrom(weekStartISO: string, todayISO: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const diff = Math.round((ms(todayISO) - ms(weekStartISO)) / 86_400_000);
  return Math.max(1, Math.min(7, diff + 1));
}

const DIRECTION_HE: Record<string, string> = { LONG: 'לונג', SHORT: 'שורט' };
const RESULT_HE: Record<string, string> = { WIN: 'רווח', LOSS: 'הפסד', BE: 'ללא שינוי' };

/** R with one decimal and no sign character.
 *
 *  The sign is carried by a Hebrew word instead — "מינוס 1.0R". A minus glyph
 *  next to Hebrew text is placed by the bidi algorithm, not by the author,
 *  and it lands on the wrong end of the number often enough that a losing
 *  week can read as a winning one. */
export function absR(r: number): string {
  return `${Math.abs(r).toFixed(1)}R`;
}

export function signedRHe(r: number): string {
  if (Math.abs(r) < 0.05) return 'אפס';
  return `${r > 0 ? 'פלוס' : 'מינוס'} ${absR(r)}`;
}

function countPhrase(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

/** One line per trade, in the trader's own terms. */
function tradeLine(t: TradeEntry): string {
  const when = `${weekdayHe(t.dateISO)}, ${shortDateHe(t.dateISO)}`;
  const what = `${t.symbol} ${DIRECTION_HE[t.direction] ?? ''}`.trim();
  const outcome = RESULT_HE[t.result] ?? '';
  const r = typeof t.tradeR === 'number' && t.result !== 'BE' ? ` של ${absR(t.tradeR)}` : '';
  return `ביום ${when} — ${what}: ${outcome}${r}.`;
}

export interface FactualWeekInput {
  /** Every trade dated inside the current ISO week, closed or open. */
  weekTrades: readonly TradeEntry[];
  /** Last week's trades. Counted, never compared — see the closing paragraph. */
  prevWeekTrades: readonly TradeEntry[];
  /** The whole journal, so the week can be placed inside it. */
  journalTrades: readonly TradeEntry[];
  /** Days elapsed in the week, counting today (1 = Monday). */
  daysIn: number;
  /** Decided trades in one week at which the model's letter takes over. Named
   *  in the closing paragraph so the trader knows what the two reports are. */
  claimFloor: number;
}

/** Builds the report. Pure: same trades in, same words out. */
export function factualWeeklyReport(input: FactualWeekInput): FactualWeeklyReport {
  const closed = input.weekTrades.filter(t => t.result !== 'OPEN');
  const open = input.weekTrades.length - closed.length;
  const { wins, losses, decided } = decidedCounts(closed);
  const be = closed.length - decided;
  const netR = closed.reduce((sum, t) => sum + (typeof t.tradeR === 'number' ? t.tradeR : 0), 0);

  const journalClosed = input.journalTrades.filter(t => t.result !== 'OPEN');
  const journal = decidedCounts(journalClosed);
  const prevClosed = input.prevWeekTrades.filter(t => t.result !== 'OPEN').length;

  const paragraphs: string[] = [];

  // 1 — what the week held.
  if (closed.length === 0) {
    if (input.daysIn <= 2 && open === 0) {
      paragraphs.push(`השבוע רק התחיל — עברו ממנו ${countPhrase(input.daysIn, 'יום אחד', 'ימים')}, ועדיין לא נסגרה בו עסקה. אין כאן חוסר ואין כאן פיגור, פשוט עוד לא היה זמן.`);
    } else if (open > 0) {
      paragraphs.push(open === 1
        ? 'השבוע עוד לא נסגרה עסקה. יש ביומן עסקה אחת פתוחה שממתינה לסגירה, ועד שתיסגר אין לה תוצאה שאפשר לספור.'
        : `השבוע עוד לא נסגרה עסקה. יש ביומן ${open} עסקאות פתוחות שממתינות לסגירה, ועד שייסגרו אין להן תוצאה שאפשר לספור.`);
    } else {
      paragraphs.push('השבוע לא נסגרה אף עסקה ולא נפתחה אף עסקה. השבוע הזה עבר בלי מסחר.');
    }
  } else {
    const split = [
      wins > 0 ? countPhrase(wins, 'רווח אחד', 'ברווח') : null,
      losses > 0 ? countPhrase(losses, 'הפסד אחד', 'בהפסד') : null,
      be > 0 ? countPhrase(be, 'אחת ללא שינוי', 'ללא שינוי') : null,
    ].filter(Boolean).join(', ');
    const openTail = open > 0 ? ` בנוסף ${countPhrase(open, 'עסקה אחת נשארה פתוחה', 'עסקאות נשארו פתוחות')}.` : '';
    paragraphs.push(`השבוע נסגרו ${countPhrase(closed.length, 'עסקה אחת', 'עסקאות')}: ${split}. סך הכול ${signedRHe(netR)}.${openTail}`);

    // 2 — the trades themselves. The most concrete thing the report can say,
    // and at this sample the only thing it should.
    paragraphs.push(`אלה העסקאות עצמן: ${closed.map(tradeLine).join(' ')}`);
  }

  // 3 — where the week sits in the journal. A count, so the trader can see
  // the week against the whole rather than only against the floor.
  if (journalClosed.length > 0) {
    const share = closed.length > 0 ? ` ${countPhrase(closed.length, 'אחת מהן נסגרה', 'מהן נסגרו')} השבוע.` : '';
    const prevTail = prevClosed === 0
      ? ' בשבוע שעבר לא נסגרו עסקאות.'
      : prevClosed === 1
        ? ' בשבוע שעבר נסגרה עסקה אחת.'
        : ` בשבוע שעבר נסגרו ${prevClosed} עסקאות.`;
    paragraphs.push(`ביומן כולו נסגרו עד היום ${countPhrase(journalClosed.length, 'עסקה אחת', 'עסקאות')} — ${journal.wins} ברווח, ${journal.losses} בהפסד.${share}${prevTail}`);
  }

  // 4 — the limits, said out loud. Rendered last, which the panel shows as
  // the takeaway callout: on a week like this the takeaway IS the limit.
  if (closed.length === 0) {
    paragraphs.push('אין כאן מה לנתח, וזו לא ביקורת. שבוע שלא הופיע בו סטאפ שעונה על התנאים שהגדרת הוא שבוע שעשית בו את מה שצריך — סבלנות היא לא היעדר עבודה. רשמתי את השבוע כדי שיישאר לו מקום ברצף, לא כדי לסמן חוסר.');
  } else {
    paragraphs.push(`מה שאי אפשר להגיד על השבוע הזה: ${countPhrase(decided, 'עסקה אחת שהוכרעה', 'עסקאות שהוכרעו')} זה מעט מדי כדי להפריד בין הרגל לבין מקריות. כל חיתוך — לפי מכשיר, לפי סשן, לפי כיוון — נשען כאן על עסקה או שתיים, ובגודל כזה גם רצף שלם של רווחים או של הפסדים הוא תוצאה סבירה לגמרי של מזל. לכן לא כתבתי כאן מגמה, סיבה או מסקנה על השיטה שלך: הדוח הזה מתעד את השבוע כפי שהיה. מ־${input.claimFloor} עסקאות סגורות בשבוע אחד נכתב הדוח המלא, זה שמשווה ומסביר.`);
  }

  return {
    paragraphs,
    facts: {
      kind: 'factual',
      closedThisWeek: closed.length,
      openThisWeek: open,
      wins, losses, breakEven: be, decided,
      netR: Number(netR.toFixed(2)),
      prevWeekClosed: prevClosed,
      journalClosed: journalClosed.length,
    },
  };
}
