'use client';

import { useEffect, useRef, useState } from 'react';
import type { Candle, TF } from '../lib/engine/types';

interface TVCandle { tf: string; o: number; h: number; l: number; c: number; t: number; }

const VALID_TFS = new Set(['1m', '2m', '3m', '5m']);

function toCandle(raw: TVCandle): Candle | null {
  if (!VALID_TFS.has(raw.tf)) return null;
  return {
    tf:        raw.tf as TF,
    open:      raw.o,
    high:      raw.h,
    low:       raw.l,
    close:     raw.c,
    open_time: raw.t,
  };
}

export type TvStatus = 'idle' | 'receiving' | 'error';

export interface TvCandlesResult {
  /** Latest closed candle per TF (most recently received) */
  latestByTf:   Partial<Record<TF, Candle>>;
  /** Status — 'receiving' once at least one candle has arrived */
  status:        TvStatus;
  /** Callback — call this with engine's processClosedCandles */
  onNewCandles?: never;  // consumed internally via onCandles prop
}

/**
 * Polls /api/tv-webhook every 2s.
 * When new candles arrive (newer than lastSeen per TF), calls onCandles.
 */
export function useTvCandles(onCandles: (candles: Candle[]) => void): TvCandlesResult {
  const lastSeen   = useRef<Map<string, number>>(new Map());
  const onCandlesR = useRef(onCandles);
  onCandlesR.current = onCandles;

  const [status,     setStatus]    = useState<TvStatus>('idle');
  const [latestByTf, setLatestByTf] = useState<Partial<Record<TF, Candle>>>({});

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch('/api/tv-webhook', { cache: 'no-store' });
        if (!res.ok || !alive) return;

        const data: TVCandle[] = await res.json();
        if (!Array.isArray(data) || data.length === 0) return;

        const fresh: Candle[] = [];
        const updated: Partial<Record<TF, Candle>> = {};

        for (const raw of data) {
          const candle = toCandle(raw);
          if (!candle) continue;

          const seen = lastSeen.current.get(raw.tf) ?? 0;
          if (raw.t > seen) {
            lastSeen.current.set(raw.tf, raw.t);
            fresh.push(candle);
            updated[candle.tf] = candle;
          }
        }

        if (fresh.length > 0) {
          // Sort oldest → newest so SM processes in order
          fresh.sort((a, b) => a.open_time - b.open_time);
          setStatus('receiving');
          setLatestByTf(prev => ({ ...prev, ...updated }));
          onCandlesR.current(fresh);
        }
      } catch {
        if (alive) setStatus('error');
      }
    }

    poll();
    const id = setInterval(poll, 2_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return { latestByTf, status };
}
