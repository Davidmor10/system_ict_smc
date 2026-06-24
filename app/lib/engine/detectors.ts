import { TF_PRIORITY, type TF, type Candle, type FVG, type ManipLeg, type LiquidityLevel } from './types';

const TICK_SIZE              = 0.25;   // ES/NQ minimum tick
const MIN_GAP_TICKS: Record<TF, number> = { '5m': 3, '3m': 2, '2m': 1.5, '1m': 1 };
const DISPLACEMENT_MULT      = 1.5;
const SWEEP_LOOKBACK         = 5;

// ── FVG Detection ─────────────────────────────────────────────────────────────

export function detectFVG(history: Candle[], tf: TF): FVG | null {
  if (history.length < 3) return null;
  const [c1, c2, c3] = history.slice(-3) as [Candle, Candle, Candle];

  if (c1.high < c3.low) {
    const fvg: FVG = {
      tf, direction: 'bullish',
      gap_bottom: c1.high, gap_top: c3.low,
      formed_at: c3.open_time, candles: [c1, c2, c3],
    };
    return isSignificant(fvg) ? fvg : null;
  }

  if (c3.high < c1.low) {
    const fvg: FVG = {
      tf, direction: 'bearish',
      gap_bottom: c3.high, gap_top: c1.low,
      formed_at: c3.open_time, candles: [c1, c2, c3],
    };
    return isSignificant(fvg) ? fvg : null;
  }

  return null;
}

function isSignificant(fvg: FVG): boolean {
  return (fvg.gap_top - fvg.gap_bottom) >= MIN_GAP_TICKS[fvg.tf] * TICK_SIZE;
}

// ── Reversal ManipLeg ─────────────────────────────────────────────────────────

export function detectReversalLeg(
  fvg:    FVG,
  history: Candle[],
  levels:  LiquidityLevel[],
): ManipLeg | null {
  // Look at the 5 candles that came BEFORE the 3-candle FVG structure
  const pre = history.slice(-3 - SWEEP_LOOKBACK, -3);
  if (!pre.length) return null;

  const swept = levels.find(level => didSweepLevel(pre, level));
  if (!swept) return null;

  return makeLeg(fvg, swept.price);
}

// Multi-candle sweep detection: maxHigh/minLow across the window
function didSweepLevel(candles: Candle[], level: LiquidityLevel): boolean {
  if (level.side === 'high') {
    const maxHigh   = Math.max(...candles.map(c => c.high));
    const lastClose = candles[candles.length - 1].close;
    return maxHigh > level.price && lastClose < level.price;
  } else {
    const minLow    = Math.min(...candles.map(c => c.low));
    const lastClose = candles[candles.length - 1].close;
    return minLow < level.price && lastClose > level.price;
  }
}

// ── Continuation ManipLeg ─────────────────────────────────────────────────────

export function detectContinuationLeg(fvg: FVG): ManipLeg | null {
  const [c1, c2, c3] = fvg.candles;
  const c2Body  = Math.abs(c2.close - c2.open);
  const avgBody = (Math.abs(c1.close - c1.open) + Math.abs(c3.close - c3.open)) / 2;
  if (c2Body <= avgBody * DISPLACEMENT_MULT) return null;
  return makeLeg(fvg, null);
}

// ── DetectorPipeline ──────────────────────────────────────────────────────────

const HISTORY_SIZE = 20;

export class DetectorPipeline {
  private history = new Map<TF, Candle[]>(
    TF_PRIORITY.map(tf => [tf, []]),
  );

  constructor(
    private getLevels: () => LiquidityLevel[],
    private onLeg:     (tf: TF, fvg: FVG, rev: ManipLeg | null, cont: ManipLeg | null) => void,
  ) {}

  process(closed: Candle[]): void {
    // Update history for each closed candle
    for (const c of closed) {
      const h = this.history.get(c.tf)!;
      h.push(c);
      if (h.length > HISTORY_SIZE) h.shift();
    }

    // Run detectors in TF_PRIORITY order
    for (const tf of TF_PRIORITY) {
      if (!closed.some(c => c.tf === tf)) continue;
      const h = this.history.get(tf)!;
      if (h.length < 3) continue;

      const fvg = detectFVG(h, tf);
      if (!fvg) continue;

      const levels = this.getLevels();
      const rev    = detectReversalLeg(fvg, h, levels);
      const cont   = detectContinuationLeg(fvg);
      if (!rev && !cont) continue;

      this.onLeg(tf, fvg, rev, cont);
    }
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────

function makeLeg(fvg: FVG, sweptAt: number | null): ManipLeg {
  return {
    tf:          fvg.tf,
    fvg,
    direction:   fvg.direction,
    formed_at:   fvg.formed_at,
    swept_level: sweptAt,
    invalidated: false,
  };
}
