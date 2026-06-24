'use client';

import { useEffect, useRef, useState } from 'react';
import { liquidityStore } from '../lib/engine';
import type { LiquidityLevel } from '../lib/engine/types';

const POLL_MS = 5 * 60_000;   // refresh levels every 5 minutes

export interface LevelsState {
  levels:  LiquidityLevel[];
  loading: boolean;
  error:   boolean;
}

export function useLiquidityLevels(): LevelsState {
  const [state, setState] = useState<LevelsState>({ levels: [], loading: true, error: false });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;

    async function fetch_() {
      try {
        const res = await fetch('/api/levels', { cache: 'no-store' });
        if (!res.ok || !alive) return;
        const data: LiquidityLevel[] = await res.json();
        if (!Array.isArray(data) || !alive) return;

        // Populate the engine's liquidity store
        liquidityStore.set(data);
        setState({ levels: data, loading: false, error: false });
      } catch {
        if (alive) setState(prev => ({ ...prev, loading: false, error: true }));
      }
    }

    fetch_();
    timerRef.current = setInterval(fetch_, POLL_MS);
    return () => {
      alive = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return state;
}
