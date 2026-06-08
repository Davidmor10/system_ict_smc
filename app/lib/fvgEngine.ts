// Standalone FVG/iFVG classification engine.
// Status transitions are locked to candle-body closes — no live tick price changes classification.
// The untested+blown-through case uses bars[last].close, not an external price tick.

export type FVGStatus = 'ACTIVE' | 'HONORED' | 'EXPLOSIVE' | 'INVERTED' | 'MITIGATED';

// Minimal bar shape — structurally compatible with CandleBar in useMarketStream.
interface Bar {
  time: number; open: number; high: number; low: number; close: number; volume: number;
}

export interface EnhancedFVGZone {
  type: 'BULLISH' | 'BEARISH';
  top: number;
  bottom: number;
  midpoint: number;
  time: number;
  tf: string;
  status: FVGStatus;
  explosive: boolean;
  inverted: boolean;
  fillPct: number;    // 0–100; set by annotateFillPct, 0 until then
  mitigated: boolean; // always false — MITIGATED is unreachable in current logic
}

export interface FVGBiasFilter {
  honoredBull:    EnhancedFVGZone[];
  honoredBear:    EnhancedFVGZone[];
  explosiveBull:  EnhancedFVGZone[];
  explosiveBear:  EnhancedFVGZone[];
  iFVGSupport:    EnhancedFVGZone[];
  iFVGResistance: EnhancedFVGZone[];
}

/**
 * Detect and classify all FVGs in a bar array using only candle-body closes.
 * Untested+blown-through: classified via bars[last].close, not a live tick.
 * MITIGATED zones are filtered out; INVERTED zones remain as active opposing zones.
 */
export function detectFVGs(bars: Bar[], tf: string): EnhancedFVGZone[] {
  if (!bars || bars.length < 3) return [];
  const lastClose = bars[bars.length - 1].close;
  const result: EnhancedFVGZone[] = [];

  for (let i = 2; i < bars.length; i++) {
    const b0 = bars[i - 2], b2 = bars[i];

    // ── Bullish FVG: b2.low > b0.high ────────────────────────────────────
    if (b2.low > b0.high) {
      const bottom = b0.high, top = b2.low;
      const sz = top - bottom;
      if (sz < 0.1) continue;
      const midpoint = (top + bottom) / 2;

      let tested = false, crossedCE = false, wasInverted = false;
      for (let j = i + 1; j < bars.length; j++) {
        const lb = bars[j];
        if (lb.low > top) continue;
        tested = true;
        const bodyLow = Math.min(lb.open, lb.close);
        if (bodyLow < bottom) { wasInverted = true; break; }
        if (bodyLow < midpoint) crossedCE = true;
      }

      const status: FVGStatus =
        wasInverted                     ? 'INVERTED' :
        (!tested && lastClose < bottom) ? 'INVERTED' : // last closed candle blew through
        !tested                         ? 'ACTIVE'   :
        crossedCE                       ? 'HONORED'  : 'EXPLOSIVE';

      result.push({
        type: 'BULLISH', top, bottom, midpoint, time: bars[i - 1].time, tf,
        status, explosive: status === 'EXPLOSIVE', inverted: status === 'INVERTED',
        fillPct: 0, mitigated: false,
      });
    }

    // ── Bearish FVG: b2.high < b0.low ────────────────────────────────────
    if (b2.high < b0.low) {
      const bottom = b2.high, top = b0.low;
      const sz = top - bottom;
      if (sz < 0.1) continue;
      const midpoint = (top + bottom) / 2;

      let tested = false, crossedCE = false, wasInverted = false;
      for (let j = i + 1; j < bars.length; j++) {
        const lb = bars[j];
        if (lb.high < bottom) continue;
        tested = true;
        const bodyHigh = Math.max(lb.open, lb.close);
        if (bodyHigh > top) { wasInverted = true; break; }
        if (bodyHigh > midpoint) crossedCE = true;
      }

      const status: FVGStatus =
        wasInverted                  ? 'INVERTED' :
        (!tested && lastClose > top) ? 'INVERTED' : // last closed candle blew through
        !tested                      ? 'ACTIVE'   :
        crossedCE                    ? 'HONORED'  : 'EXPLOSIVE';

      result.push({
        type: 'BEARISH', top, bottom, midpoint, time: bars[i - 1].time, tf,
        status, explosive: status === 'EXPLOSIVE', inverted: status === 'INVERTED',
        fillPct: 0, mitigated: false,
      });
    }
  }

  return result.filter(f => f.status !== 'MITIGATED');
}

/**
 * Adds live-price fill context to classified zones.
 * Returns a new array — never modifies the status field.
 */
export function annotateFillPct(fvgs: EnhancedFVGZone[], price: number): EnhancedFVGZone[] {
  return fvgs.map(f => {
    const sz = f.top - f.bottom;
    let fillPct = 0;
    if (f.type === 'BULLISH') {
      if (price >= f.bottom && price <= f.top) fillPct = ((price - f.bottom) / sz) * 100;
      else if (price <= f.bottom) fillPct = 100;
    } else {
      if (price >= f.bottom && price <= f.top) fillPct = ((f.top - price) / sz) * 100;
      else if (price >= f.top) fillPct = 100;
    }
    return { ...f, fillPct };
  });
}

/**
 * Partitions an FVG array into bias-scoring buckets given the current price.
 * Used by computeStableBias and computeFactors in useMarketStream.
 */
export function filterForBias(fvgs: EnhancedFVGZone[], price: number): FVGBiasFilter {
  const honoredBull = fvgs.filter(f =>
    f.type === 'BULLISH' && !f.inverted &&
    (f.status === 'HONORED' || f.status === 'EXPLOSIVE') && f.top < price,
  );
  const honoredBear = fvgs.filter(f =>
    f.type === 'BEARISH' && !f.inverted &&
    (f.status === 'HONORED' || f.status === 'EXPLOSIVE') && f.bottom > price,
  );
  return {
    honoredBull,
    honoredBear,
    explosiveBull:  honoredBull.filter(f => f.explosive),
    explosiveBear:  honoredBear.filter(f => f.explosive),
    iFVGSupport:    fvgs.filter(f => f.inverted && f.type === 'BEARISH' && f.top    < price),
    iFVGResistance: fvgs.filter(f => f.inverted && f.type === 'BULLISH' && f.bottom > price),
  };
}
