import type { Bias, BiasAlignment, Direction } from './journal';

/** Is this trade with or against the direction recorded ON THE TRADE.
 *
 *  The direction used to be declared on the dashboard each morning and read
 *  back here by date. That is gone: it is now one optional field on the trade
 *  itself, which removes an entire class of failure — a declaration keyed to
 *  the wrong day, keyed by the wrong clock, made after the trade, or held in
 *  two places that disagree. The trade knows which day it belongs to.
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
