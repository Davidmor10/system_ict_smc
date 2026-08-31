import type { Bias, BiasAlignment, Direction } from './journal';
import { readOwned } from './sync/owned';

const PLAN_BIAS_MAP: Record<string, Bias> = { bull: 'BULLISH', bear: 'BEARISH', neutral: 'INDECISIVE' };

/** The day, in the trader's timezone.
 *
 *  This used to be `toISOString().slice(0, 10)`, which is UTC. Israel is two
 *  or three hours ahead, so from 21:00 or 22:00 local the key rolled to
 *  tomorrow and the bias the trader declared that morning silently stopped
 *  being found — during the New York PM session, which is when they were most
 *  likely to be trading. */
function todayKey() {
  // Local, not UTC — and computed here rather than imported from journal.ts,
  // which now imports this module for computeBiasAlignment. The cycle would
  // resolve at runtime (both are called from inside functions) and would be a
  // trap for whoever next moves a call to module scope.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Reads the bias the trader declared for today in the dashboard's daily plan — the same
 * value shown in the hero's bias card. Returns null if no plan was saved today. */
export function getTodaysDeclaredBias(): Bias | null {
  if (typeof window === 'undefined') return null;
  try {
    const o = readOwned<{ bias?: string }>('onyx_dash_planobj_' + todayKey());
    if (!o?.bias) return null;
    return PLAN_BIAS_MAP[o.bias] ?? null;
  } catch {
    return null;
  }
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
