import type { Bias, BiasAlignment, Direction } from './journal';
import { readOwned } from './sync/owned';
import { clockInZone, todayISOInZone } from './time/zone';

const PLAN_BIAS_MAP: Record<string, Bias> = { bull: 'BULLISH', bear: 'BEARISH', neutral: 'INDECISIVE' };

/** A day key, in the trader's configured zone.
 *
 *  Must produce byte-for-byte what entryGate.planDayKey produces — one writes
 *  the record and the other reads it. Both now resolve through
 *  todayISOInZone, which is also where the trade's own date comes from, so
 *  all three agree on what day it is.
 *
 *  This was UTC once: Israel is two or three hours ahead, so from 21:00 the
 *  key rolled to tomorrow and the morning's direction stopped being found —
 *  during the New York PM session, which is exactly when it was needed. The
 *  fix for that used the BROWSER's zone, which is right only while the browser
 *  and the settings agree. */
function dayKey(at: Date = new Date()): string {
  return todayISOInZone(undefined, at);
}

/** The direction the trader declared for a GIVEN DAY, `YYYY-MM-DD`.
 *
 *  Takes the day rather than assuming today, because the trade form does not
 *  only log trades that happened today. Logging Sunday's trades on Tuesday
 *  read Tuesday's declaration and graded Sunday's trades against a direction
 *  chosen two days after they were closed — a wrong alignment written into the
 *  database, indistinguishable afterwards from a real one. */
export function getDeclaredBiasForDate(dateISO: string): Bias | null {
  if (typeof window === 'undefined') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  try {
    const o = readOwned<{ bias?: string }>('onyx_dash_planobj_' + dateISO);
    if (!o?.bias) return null;
    return PLAN_BIAS_MAP[o.bias] ?? null;
  } catch {
    return null;
  }
}

/** The declaration for a day, with the moment it was made.
 *
 *  `at` is null when the record predates the timestamp, or holds something
 *  that is not a number. Callers must treat that as "cannot verify when" —
 *  see `declarationPrecededTrade`. */
export function getDeclarationForDate(dateISO: string): { bias: Bias; at: number | null } | null {
  if (typeof window === 'undefined') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  try {
    const o = readOwned<{ bias?: string; biasAt?: unknown }>('onyx_dash_planobj_' + dateISO);
    if (!o?.bias) return null;
    const bias = PLAN_BIAS_MAP[o.bias];
    if (!bias) return null;
    return { bias, at: typeof o.biasAt === 'number' ? o.biasAt : null };
  } catch {
    return null;
  }
}

/** Was the direction committed to BEFORE the trade was taken.
 *
 *  A direction written down after the trade closed is not a plan the trade
 *  can be measured against — it is the trade explaining itself. Both readings
 *  look identical once stored, so without this the coach could say "your
 *  trades followed the direction you set" about a day whose direction was set
 *  at 23:00, after a losing session. That sentence would be false, on a screen
 *  whose whole value is that it is not.
 *
 *  Compared as WALL CLOCK in the trader's own zone on both sides — the
 *  declaration instant converted into that zone, the trade's date and time
 *  already in it. No offset arithmetic, so nothing to get wrong twice a year.
 *
 *  Unverifiable (`at` null) returns false: a claim that cannot be checked is
 *  not made. */
export function declarationPrecededTrade(at: number | null, tradeDateISO: string, tradeTime: string): boolean {
  if (at === null || !Number.isFinite(at)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDateISO) || !/^\d{2}:\d{2}$/.test(tradeTime)) return false;
  const when = new Date(at);
  const declaredOn = todayISOInZone(undefined, when);
  if (declaredOn !== tradeDateISO) return declaredOn < tradeDateISO;
  return clockInZone(undefined, when) <= tradeTime;
}

/** The direction declared for today. */
export function getTodaysDeclaredBias(): Bias | null {
  if (typeof window === 'undefined') return null;
  return getDeclaredBiasForDate(dayKey());
}

/** Is this trade with or against the direction the trader declared for the day.
 *
 *  Returns NULL when there is no declared direction, and that is the whole
 *  point of this function's existence in its current form. It used to return
 *  'ALIGNED' — "nothing to misalign with, so treat it as aligned" — which
 *  meant that a trader who had not written a bias that morning had every trade
 *  they took, long and short alike, recorded as being with the day's
 *  direction. The journal then showed "מיושרת עם הביאס של היום" under a long
 *  and a short taken twenty minutes apart, and the pattern engine had a
 *  bias_alignment slice in which one value was universal and therefore
 *  meaningless.
 *
 *  It is the same failure as followed_rules defaulting to true, exits never
 *  being collected, and confirmations counted before the field was used: an
 *  absent answer read as a positive one. Absent is its own answer.
 *
 *  INDECISIVE is also null, and for a stronger reason: a trader with no
 *  directional view has nothing for a trade to agree or disagree with. Calling
 *  that alignment would be inventing a comparison. */
export function computeBiasAlignment(bias: Bias | null, direction: Direction): BiasAlignment | null {
  if (!bias || bias === 'INDECISIVE') return null;
  if (bias === 'BULLISH' && direction === 'LONG')  return 'ALIGNED';
  if (bias === 'BEARISH' && direction === 'SHORT') return 'ALIGNED';
  return 'COUNTER';
}
