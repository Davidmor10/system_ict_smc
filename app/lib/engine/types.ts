// ─── Core primitives ──────────────────────────────────────────────────────────

export type TF        = '5m' | '3m' | '2m' | '1m';
export type Direction = 'bullish' | 'bearish';
export type Mode      = 'REVERSAL' | 'CONTINUATION';
export type Phase     = 'IDLE' | 'ZONE_ACTIVE' | 'MANIP_WATCH' | 'CONFIRMATION';

export const TF_PRIORITY: TF[] = ['5m', '3m', '2m', '1m'];
export const TF_MS: Record<TF, number> = {
  '5m': 300_000,
  '3m': 180_000,
  '2m': 120_000,
  '1m':  60_000,
};

// ─── Market data ──────────────────────────────────────────────────────────────

export interface Tick {
  price:     number;
  timestamp: number;
}

export interface Candle {
  tf:        TF;
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  open_time: number;
}

// ─── FVG ─────────────────────────────────────────────────────────────────────

export interface FVG {
  tf:         TF;
  direction:  Direction;
  gap_top:    number;
  gap_bottom: number;
  formed_at:  number;
  candles:    [Candle, Candle, Candle];
}

// ─── Manipulation leg ─────────────────────────────────────────────────────────

export interface ManipLeg {
  tf:          TF;
  fvg:         FVG;
  direction:   Direction;
  formed_at:   number;
  swept_level: number | null;
  invalidated: boolean;
  inversed?:   boolean;
}

// ─── Liquidity ────────────────────────────────────────────────────────────────

export type LiqSide = 'high' | 'low';

export interface LiquidityLevel {
  price: number;
  side:  LiqSide;
  type:  'swing' | 'session_high' | 'session_low'
        | 'prev_day_high' | 'prev_day_low'
        | 'prev_week_high' | 'prev_week_low'
        | 'macro';
  swept: boolean;
}

// ─── State machine ────────────────────────────────────────────────────────────

export interface MachineState {
  phase:       Phase;
  mode:        Mode      | null;
  bias:        Direction | null;
  zone:        LiquidityLevel | FVG | null;
  active_leg:  ManipLeg  | null;
  leg_history: ManipLeg[];
  is_emitted:  boolean;
  session_id:  string;
  updated_at:  number;
}

// ─── Signals (output) ─────────────────────────────────────────────────────────

export interface YesSignal {
  result:    'YES';
  mode:      Mode;
  bias:      Direction;
  entry_tf:  TF;
  fvg:       FVG;
  zone:      LiquidityLevel | FVG;
  timestamp: number;
}

export interface NoSignal {
  result:    'NO';
  reason:    string;
  timestamp: number;
}

export type Signal = YesSignal | NoSignal;

// ─── Detector event ───────────────────────────────────────────────────────────

export interface LEGFoundEvent {
  tf:               TF;
  fvg:              FVG;
  reversal_leg:     ManipLeg | null;
  continuation_leg: ManipLeg | null;
  timestamp:        number;
}

// ─── State machine events ─────────────────────────────────────────────────────

export type SMEvent =
  | { type: 'BIAS_SET';         bias: Direction; mode: Mode }
  | { type: 'ZONE_TOUCHED';     zone: LiquidityLevel }
  | { type: 'ZONE_ENTERED';     fvg:  FVG }
  | { type: 'LEG_FOUND';        tf: TF; fvg: FVG;
      reversal_leg: ManipLeg | null; continuation_leg: ManipLeg | null;
      timestamp: number }
  | { type: 'CANDLE_CLOSE';     candle: Candle; tf: TF }
  | { type: 'ZONE_INVALIDATED' };
