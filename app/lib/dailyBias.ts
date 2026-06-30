import type { Bias, BiasAlignment, Direction } from './journal';

const PLAN_BIAS_MAP: Record<string, Bias> = { bull: 'BULLISH', bear: 'BEARISH', neutral: 'INDECISIVE' };

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** Reads the bias the trader declared for today in the dashboard's daily plan — the same
 * value shown in the hero's bias card. Returns null if no plan was saved today. */
export function getTodaysDeclaredBias(): Bias | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('onyx_dash_planobj_' + todayKey());
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o?.bias) return null;
    return PLAN_BIAS_MAP[o.bias] ?? null;
  } catch {
    return null;
  }
}

/** A trade with no declared bias for the day has nothing to misalign with — treated as aligned. */
export function computeBiasAlignment(bias: Bias | null, direction: Direction): BiasAlignment {
  if (!bias || bias === 'INDECISIVE') return 'ALIGNED';
  if (bias === 'BULLISH' && direction === 'LONG') return 'ALIGNED';
  if (bias === 'BEARISH' && direction === 'SHORT') return 'ALIGNED';
  return 'COUNTER';
}
