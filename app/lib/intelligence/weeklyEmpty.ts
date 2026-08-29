// ─────────────────────────────────────────────────────────────────────────────
// What the weekly report says when there is no weekly report.
//
// It said one thing, always: "no report yet — it is written on the current
// week only, and needs at least five closed trades." Correct, and useless. A
// trader who took nothing all week read a rule about a threshold, as though
// not trading were a failure to feed the machine.
//
// It is not. A week without a setup that met the trader's own conditions is a
// week they did exactly what they should have, and a journal that cannot say
// so is a journal that quietly rewards overtrading.
//
// So: three states, three different things to say, and the numbers in each are
// the trader's real ones. Pure — no model call, nothing invented.
// ─────────────────────────────────────────────────────────────────────────────

import { MIN_TRADES_FOR_WEEKLY } from './weeklyRules';

export type WeeklyEmptyKind = 'early' | 'none' | 'thin';

export interface WeeklyEmptyState {
  kind: WeeklyEmptyKind;
  /** The line that names the state. */
  title: string;
  /** Why that is a legitimate state to be in, or what is still missing. */
  body: string;
  /** When the report becomes available. Always the same fact, said last. */
  note: string;
}

/** Trading days elapsed in the current week, counting today.
 *
 *  ISO weeks start on Monday, and the Israeli trading week runs Sunday to
 *  Thursday — so what matters here is not the calendar but how much of the
 *  week the trader has actually had. Monday morning is not a week without
 *  trades, it is a week that has not happened yet, and saying "you took
 *  nothing this week" then is both wrong and discouraging. */
export function daysIntoWeek(dayOfWeek: number): number {
  // dayOfWeek: 0 = Sunday … 6 = Saturday, as Date.getDay() gives it.
  // ISO week starts Monday, so Sunday closes the previous one.
  return dayOfWeek === 0 ? 7 : dayOfWeek;
}

/** How early is too early to call a week empty. Two days in — Monday and
 *  Tuesday — a trader with no setup yet has had barely any chance at one. */
const EARLY_DAYS = 2;

export function weeklyEmptyState(closedThisWeek: number, dayOfWeek: number): WeeklyEmptyState {
  const missing = Math.max(0, MIN_TRADES_FOR_WEEKLY - closedThisWeek);
  const note = `הדוח נכתב על השבוע הנוכחי בלבד, וייכתב כשייסגרו בו ${MIN_TRADES_FOR_WEEKLY} עסקאות. עסקאות משבועות קודמים לא נספרות כאן.`;

  if (closedThisWeek === 0 && daysIntoWeek(dayOfWeek) <= EARLY_DAYS) {
    return {
      kind: 'early',
      title: 'השבוע רק התחיל',
      body: 'עוד לא נסגרו עסקאות. אין כאן מה לדווח ואין כאן מה לתקן — פשוט עוד לא היה זמן.',
      note,
    };
  }

  if (closedThisWeek === 0) {
    return {
      kind: 'none',
      title: 'לא סחרת השבוע',
      body: 'וזו יכולה להיות בדיוק ההחלטה הנכונה. שבוע שבו לא הופיע סטאפ שעונה על התנאים שאתה הגדרת הוא שבוע שעשית בו את מה שצריך — סבלנות היא לא היעדר עבודה. המערכת לא סופרת ימים בלי עסקאות כנגדך, ולא תמציא ניתוח על שבוע שלא היה בו מה לנתח.',
      note,
    };
  }

  return {
    kind: 'thin',
    title: closedThisWeek === 1 ? 'עסקה אחת נסגרה השבוע' : `${closedThisWeek} עסקאות נסגרו השבוע`,
    body: `זה מעט מכדי לכתוב על השבוע משהו שיחזיק. ${missing === 1 ? 'עוד עסקה אחת' : `עוד ${missing} עסקאות`} והדוח ייכתב. עד אז — המספרים עצמם כבר על המסך בעמוד הסטטיסטיקות, והתובנה היומית ממשיכה לעבוד על כל עסקה בנפרד.`,
    note,
  };
}
