'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { engineEmitter, getEngine } from '../lib/engine';
import type { Phase, Direction, Mode, Signal } from '../lib/engine/types';

const SIGNAL_MAX = 20;

export interface EngineHook {
  phase:   Phase;
  bias:    Direction | null;
  mode:    Mode      | null;
  signals: Signal[];
  last:    Signal    | null;
  setBias: (bias: Direction, mode: Mode) => void;
}

export function useDecisionEngine(esPrice: number): EngineHook {
  const [phase,   setPhase]   = useState<Phase>('IDLE');
  const [bias,    setBiasS]   = useState<Direction | null>(null);
  const [mode,    setModeS]   = useState<Mode | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);

  const engineRef = useRef<ReturnType<typeof getEngine> | null>(null);

  // ── Boot engine once on client ────────────────────────────────────────────

  useEffect(() => {
    engineRef.current = getEngine((sig) => {
      engineEmitter.emit('signal', sig);
    });

    const unsubs = [
      engineEmitter.on('phase_change', setPhase),
      engineEmitter.on('signal', (sig) =>
        setSignals(prev => [sig, ...prev].slice(0, SIGNAL_MAX)),
      ),
    ];

    return () => unsubs.forEach(u => u());
  }, []);

  // ── Feed price ticks from useLivePrices (ES) ──────────────────────────────

  const prevPrice = useRef(0);
  useEffect(() => {
    if (!esPrice || esPrice === prevPrice.current) return;
    prevPrice.current = esPrice;
    engineRef.current?.onTick({ price: esPrice, timestamp: Date.now() });
  }, [esPrice]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const setBias = useCallback((b: Direction, m: Mode) => {
    setBiasS(b);
    setModeS(m);
    engineRef.current?.setBias(b, m);
  }, []);

  return { phase, bias, mode, signals, last: signals[0] ?? null, setBias };
}
