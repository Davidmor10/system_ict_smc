import { CandleAggregator }  from './candleAggregator';
import { DetectorPipeline }  from './detectors';
import { StateMachine }      from './stateMachine';
import { engineEmitter }     from './emitter';
import type { Tick, Direction, Mode, LiquidityLevel, Signal } from './types';

export type { Signal, Direction, Mode } from './types';
export { engineEmitter } from './emitter';

// ── Liquidity store ───────────────────────────────────────────────────────────

let _levels: LiquidityLevel[] = [];

export const liquidityStore = {
  set:    (levels: LiquidityLevel[]) => { _levels = levels; },
  add:    (level:  LiquidityLevel)   => { _levels.push(level); },
  remove: (price:  number)           => { _levels = _levels.filter(l => l.price !== price); },
  get:    ()                         => _levels,
  clear:  ()                         => { _levels = []; },
};

// ── Engine singleton ──────────────────────────────────────────────────────────

export interface Engine {
  onTick:   (tick: Tick) => void;
  setBias:  (bias: Direction, mode: Mode) => void;
  getState: () => ReturnType<StateMachine['getState']>;
  reset:    () => void;
}

let _engine: Engine | null = null;

export function getEngine(onSignal: (sig: Signal) => void): Engine {
  if (_engine) return _engine;

  const sm = new StateMachine(onSignal);

  const detectors = new DetectorPipeline(
    () => liquidityStore.get(),
    (tf, fvg, rev, cont) =>
      sm.processBatch([{
        type: 'LEG_FOUND', tf, fvg,
        reversal_leg: rev, continuation_leg: cont,
        timestamp: Date.now(),
      }]),
  );

  const aggregator = new CandleAggregator((closed) => {
    // Detectors first (may emit LEG_FOUND)
    detectors.process(closed);
    // Then CANDLE_CLOSE for inverse + invalidation checks
    sm.processBatch(closed.map(c => ({ type: 'CANDLE_CLOSE' as const, candle: c, tf: c.tf })));
  });

  _engine = {
    onTick:   (tick) => aggregator.onTick(tick),
    setBias:  (bias, mode) => sm.processBatch([{ type: 'BIAS_SET', bias, mode }]),
    getState: () => sm.getState(),
    reset:    () => sm.reset(),
  };

  return _engine;
}
