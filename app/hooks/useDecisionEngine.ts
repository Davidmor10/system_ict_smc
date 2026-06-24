'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { engineEmitter, getEngine }    from '../lib/engine';
import { useMarketCandles, type FeedStatus } from './useMarketCandles';
import { useLiquidityLevels }          from './useLiquidityLevels';
import { israelClock, getSessionStatus, type Session } from '../lib/sessions';
import type { Phase, Direction, Mode, Signal, SMEvent } from '../lib/engine/types';

export type { FeedStatus };

const SIGNAL_MAX  = 20;
const BIAS_LS_KEY = 'onyx.engine.bias';

function loadBias(): { bias: Direction; mode: Mode } | null {
  try {
    const raw = localStorage.getItem(BIAS_LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { bias: Direction; mode: Mode };
    if (!p.bias || !p.mode) return null;
    return p;
  } catch { return null; }
}

function saveBias(bias: Direction, mode: Mode) {
  try { localStorage.setItem(BIAS_LS_KEY, JSON.stringify({ bias, mode })); } catch {}
}

export interface SessionInfo {
  inSession: boolean;
  session:   Session;
  remaining: number;
}

export interface EngineHook {
  phase:         Phase;
  bias:          Direction | null;
  mode:          Mode      | null;
  signals:       Signal[];
  last:          Signal    | null;
  sessionInfo:   SessionInfo;
  feedStatus:    FeedStatus;
  levelsCount:   number;
  setBias:       (bias: Direction, mode: Mode) => void;
  injectEvent:   (event: SMEvent) => void;
  resetEngine:   () => void;
  getSmState:    () => ReturnType<ReturnType<typeof getEngine>['getState']>;
}

export function useDecisionEngine(esPrice: number): EngineHook {
  const [phase,       setPhase]   = useState<Phase>('IDLE');
  const [bias,        setBiasS]   = useState<Direction | null>(null);
  const [mode,        setModeS]   = useState<Mode | null>(null);
  const [signals,     setSignals] = useState<Signal[]>([]);
  const [sessionInfo, setSession] = useState<SessionInfo>(() => {
    const { sec } = israelClock();
    return getSessionStatus(sec) as SessionInfo;
  });

  const engineRef      = useRef<ReturnType<typeof getEngine> | null>(null);
  const prevPrice      = useRef(0);
  const wasInSession   = useRef(false);
  const sessionInfoRef = useRef(sessionInfo);
  sessionInfoRef.current = sessionInfo;

  // ── Boot engine ───────────────────────────────────────────────────────────

  useEffect(() => {
    engineRef.current = getEngine((sig) => {
      engineEmitter.emit('signal', sig);
    });

    const saved = loadBias();
    if (saved) {
      setBiasS(saved.bias);
      setModeS(saved.mode);
      engineRef.current.setBias(saved.bias, saved.mode);
    }

    const smState = engineRef.current.getState();
    if (smState.phase) setPhase(smState.phase);

    const unsubs = [
      engineEmitter.on('phase_change', setPhase),
      engineEmitter.on('signal', (sig) =>
        setSignals(prev => [sig, ...prev].slice(0, SIGNAL_MAX)),
      ),
    ];

    return () => unsubs.forEach(u => u());
  }, []);

  // ── Session watchdog ──────────────────────────────────────────────────────

  useEffect(() => {
    const check = () => {
      const { sec }  = israelClock();
      const info     = getSessionStatus(sec) as SessionInfo;
      setSession(info);
      if (wasInSession.current && !info.inSession) engineRef.current?.reset();
      wasInSession.current = info.inSession;
    };
    check();
    const id = setInterval(check, 1_000);
    return () => clearInterval(id);
  }, []);

  // ── Yahoo Finance price → price display only ──────────────────────────────

  useEffect(() => {
    if (!sessionInfo.inSession) return;
    if (!esPrice || esPrice === prevPrice.current) return;
    prevPrice.current = esPrice;
    // onTick feeds CandleAggregator — kept as lightweight price heartbeat
    engineRef.current?.onTick({ price: esPrice, timestamp: Date.now() });
  }, [esPrice, sessionInfo.inSession]);

  // ── Real OHLCV candles from Yahoo Finance → engine (primary) ─────────────

  const feedStatus = useMarketCandles(useCallback((candles) => {
    if (!sessionInfoRef.current.inSession) return;
    engineRef.current?.processClosedCandles(candles);
  }, []));

  // ── Liquidity levels — auto-fetched, auto-populates liquidityStore ─────────

  const { levels } = useLiquidityLevels();

  // ── Actions ───────────────────────────────────────────────────────────────

  const setBias = useCallback((b: Direction, m: Mode) => {
    setBiasS(b);
    setModeS(m);
    saveBias(b, m);
    engineRef.current?.setBias(b, m);
  }, []);

  const injectEvent = useCallback((event: SMEvent) => {
    engineRef.current?.injectEvent(event);
  }, []);

  const resetEngine = useCallback(() => {
    engineRef.current?.reset();
    setSignals([]);
    setPhase('IDLE');
  }, []);

  const getSmState = useCallback(() => engineRef.current!.getState(), []);

  return {
    phase, bias, mode, signals, last: signals[0] ?? null, sessionInfo, feedStatus,
    levelsCount: levels.length,
    setBias, injectEvent, resetEngine, getSmState,
  };
}
