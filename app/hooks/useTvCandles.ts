'use client';

import { useEffect, useRef, useState } from 'react';
import type { Candle, TF } from '../lib/engine/types';
import type { TVEvent } from '../api/tv-webhook/route';

interface TVCandle { tf: string; o: number; h: number; l: number; c: number; sess: string; t: number; }

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
  latestByTf: Partial<Record<TF, Candle>>;
  status:     TvStatus;
  lastEvent:  TVEvent | null;
}

interface GetResponse {
  candles: TVCandle[];
  events:  TVEvent[];
}

/**
 * Polls /api/tv-webhook every 2s.
 * Calls onCandles for new OHLCV bars.
 * Calls onEvent for FVG / MANIP events.
 */
export function useTvCandles(
  onCandles: (candles: Candle[]) => void,
  onEvent?: (event: TVEvent) => void,
): TvCandlesResult {
  const lastSeen     = useRef<Map<string, number>>(new Map());
  const lastEventTs  = useRef(0);
  const onCandlesR   = useRef(onCandles);
  const onEventR     = useRef(onEvent);
  onCandlesR.current = onCandles;
  onEventR.current   = onEvent;

  const [status,     setStatus]     = useState<TvStatus>('idle');
  const [latestByTf, setLatestByTf] = useState<Partial<Record<TF, Candle>>>({});
  const [lastEvent,  setLastEvent]  = useState<TVEvent | null>(null);

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch('/api/tv-webhook', { cache: 'no-store' });
        if (!res.ok || !alive) return;

        const data: GetResponse = await res.json();

        // ── Candles ─────────────────────────────────────────────────────────
        const candles = Array.isArray(data.candles) ? data.candles : [];
        const fresh: Candle[] = [];
        const updated: Partial<Record<TF, Candle>> = {};

        for (const raw of candles) {
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
          fresh.sort((a, b) => a.open_time - b.open_time);
          setStatus('receiving');
          setLatestByTf(prev => ({ ...prev, ...updated }));
          onCandlesR.current(fresh);
        }

        // ── Events (FVG / MANIP) ─────────────────────────────────────────────
        const events = Array.isArray(data.events) ? data.events : [];
        const newEvents = events.filter(e => e.receivedAt > lastEventTs.current);

        if (newEvents.length > 0) {
          lastEventTs.current = Math.max(...newEvents.map(e => e.receivedAt));
          for (const ev of newEvents) {
            setLastEvent(ev);
            onEventR.current?.(ev);
          }
        }
      } catch {
        if (alive) setStatus('error');
      }
    }

    poll();
    const id = setInterval(poll, 2_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return { latestByTf, status, lastEvent };
}
