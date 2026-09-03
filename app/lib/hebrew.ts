// ─────────────────────────────────────────────────────────────────────────────
// Number-noun agreement, in one place.
//
// A template writes "1 עסקאות סגורות" and "נבדק ב-1 ההזדמנויות". Nobody does,
// and a screen whose whole purpose is to read like language cannot afford it —
// it is the single detail that makes generated prose read as generated.
//
// The rest of this codebase already handled it case by case (weeklyEmpty,
// insightPhrasing). Doing it inline is how it gets forgotten on the next
// sentence, which is exactly what happened on the summary screens.
//
// Only ONE and MANY are separated. Hebrew's dual would be a nicety here; the
// singular is the case that reads broken.
// ─────────────────────────────────────────────────────────────────────────────

export const heNum = (n: number): string => n.toLocaleString('he-IL');

/** A count with its noun, agreeing.
 *
 *  `q(1, 'עסקה סגורה אחת', 'עסקאות סגורות')` → "עסקה סגורה אחת"
 *  `q(4, 'עסקה סגורה אחת', 'עסקאות סגורות')` → "4 עסקאות סגורות" */
export function q(n: number, one: string, many: string): string {
  return n === 1 ? one : `${heNum(n)} ${many}`;
}

/** Just the quantity, feminine — "אחת" rather than "1".
 *
 *  For the places where the noun is already in the sentence and only the
 *  number reads wrong: "ועוד 1 עד לפסיקה" → "ועוד אחת עד לפסיקה". */
export const feminine = (n: number): string => (n === 1 ? 'אחת' : heNum(n));
