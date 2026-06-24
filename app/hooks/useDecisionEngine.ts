'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { engineEmitter, getEngine } from '../lib/engine';
import { israelClock, getSessionStatus, type Session } from '../lib/sessions';
import type { Phase, Direction, Mode, Signal } from '../lib/engine/types';

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
  remaining: number;   // seconds
}

export interface EngineHook {
  phase:       Phase;
  bias:        Direction | null;
  mode:        Mode      | null;
  signals:     Signal[];
  last:        Signal    | null;
  sessionInfo: SessionInfo;
  setBias:     (bias: Direction, mode: Mode) => void;
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

  const engineRef    = useRef<ReturnType<typeof getEngine> | null>(null);
  const prevPrice    = useRef(0);
  const wasInSession = useRef(false);

  // ── Boot engine ───────────────────────────────────────────────────────────

  useEffect(() => {
    engineRef.current = getEngine((sig) => {
      engineEmitter.emit('signal', sig);
    });

    // Restore bias + mode from dedicated localStorage key — reliable across navigation
    const saved = loadBias();
    if (saved) {
      setBiasS(saved.bias);
      setModeS(saved.mode);
      engineRef.current.setBias(saved.bias, saved.mode);
    }

    // Restore SM phase
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

  // ── Session watchdog — checks every second ────────────────────────────────

  useEffect(() => {
    const check = () => {
      const { sec }                   = israelClock();
      const status                    = getSessionStatus(sec);
      const info: SessionInfo         = status as SessionInfo;
      setSession(info);

      // Transition: in-session → out-of-session → reset SM
      if (wasInSession.current && !info.inSession) {
        engineRef.current?.reset();
      }
      wasInSession.current = info.inSession;
    };

    check();
    const id = setInterval(check, 1_000);
    return () => clearInterval(id);
  }, []);

  // ── Feed price ticks — ONLY when in a session ─────────────────────────────

  useEffect(() => {
    if (!sessionInfo.inSession) return;
    if (!esPrice || esPrice === prevPrice.current) return;
    prevPrice.current = esPrice;
    engineRef.current?.onTick({ price: esPrice, timestamp: Date.now() });
  }, [esPrice, sessionInfo.inSession]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const setBias = useCallback((b: Direction, m: Mode) => {
    setBiasS(b);
    setModeS(m);
    saveBias(b, m);                    // ← שמירה מיידית ב-localStorage
    engineRef.current?.setBias(b, m);
  }, []);

  return { phase, bias, mode, signals, last: signals[0] ?? null, sessionInfo, setBias };
}
