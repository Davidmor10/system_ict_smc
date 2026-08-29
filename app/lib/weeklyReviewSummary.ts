// ─────────────────────────────────────────────────────────────────────────────
// What the weekly behaviour tab says before anything else.
//
// The panel rendered whatever it had — and on a normal week what it had was a
// tracking bar and a "still unclear" list. Nothing on screen said whether
// there WAS a conclusion this week, so a trader looking at a progress bar
// reasonably concluded the system had reached one and was not showing it.
//
// It had not. A window that is nine trades from closing has produced no
// conclusion, and saying so is not an apology — it is the answer. This turns
// the review into one line that always states which of four situations the
// week is in, and never leaves the reader to infer it from what is missing.
//
// Pure. Counts in, sentence out; nothing here is generated.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewCounts {
  improved:  number;
  relapsed:  number;
  /** Behaviours with a measurement window open. */
  underTest: number;
  /** Behaviours that moved against themselves, either way. */
  moving:    number;
  /** Seen, but the evidence cannot yet support saying anything. */
  unclear:   number;
}

export type ReviewVerdict = 'none' | 'quiet' | 'collecting' | 'findings';

export interface ReviewSummary {
  kind:    ReviewVerdict;
  /** The headline. Always says whether there is a conclusion. */
  title:   string;
  /** What the week actually holds, in counts the reader can check. */
  detail:  string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

export function summarizeWeeklyReview(c: ReviewCounts | null): ReviewSummary {
  if (!c) {
    return {
      kind: 'none',
      title: 'אין עדיין סקירה שבועית',
      detail: 'המערכת עוד לא ראתה מספיק מהמסחר שלך כדי לומר משהו על שבוע שלם. היא ממשיכה לאסוף, ותכתוב את הסקירה הראשונה ברגע שיהיה עליה מה לומר.',
    };
  }

  const findings = c.improved + c.relapsed + c.moving;

  if (findings > 0) {
    const parts: string[] = [];
    if (c.improved) parts.push(`${plural(c.improved, 'התנהגות אחת השתפרה', 'התנהגויות השתפרו')}`);
    if (c.relapsed) parts.push(`${plural(c.relapsed, 'אחת חזרה', 'חזרו')}`);
    if (c.moving)   parts.push(`${plural(c.moving, 'אחת זזה מול עצמה', 'זזו מול עצמן')}`);
    return {
      kind: 'findings',
      title: 'יש מה לומר על השבוע',
      detail: `${parts.join(' · ')}. הפירוט למטה.`,
    };
  }

  if (c.underTest > 0 || c.unclear > 0) {
    const parts: string[] = [];
    if (c.underTest) parts.push(`${plural(c.underTest, 'התנהגות אחת נמצאת במדידה', 'התנהגויות נמצאות במדידה')}`);
    if (c.unclear)   parts.push(`${plural(c.unclear, 'אחת עדיין נאספת', 'עדיין נאספות')}`);
    return {
      kind: 'collecting',
      title: 'אין מסקנה השבוע — עדיין נמדד',
      detail: `${parts.join(' · ')}. מסקנה תופיע כאן כשחלון המדידה ייסגר, לא לפני. מה שרואים למטה הוא המעקב עצמו, לא תשובה.`,
    };
  }

  return {
    kind: 'quiet',
    title: 'שבוע שקט — אין תובנה חדשה',
    detail: 'שום דפוס לא השתפר, לא חזר ולא נמדד השבוע. זו תשובה, לא היעדר תשובה: לא כל שבוע מייצר ממצא, ושבוע בלי אחד עדיף על ממצא שהומצא כדי למלא מקום.',
  };
}
