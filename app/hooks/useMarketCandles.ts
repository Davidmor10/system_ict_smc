'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Candle, TF } from '../lib/engine/types';

interface RawCandle { tf: string; t: number; o: number; h: number; l: number; c: number; }

const VALID_TFS = new Set<string>(['1m', '2m', '3m', '5m']);
const POLL_MS   = 30_000;   // 30s — candles close every 60s, 30s is plenty

function toEngineCandle(r: RawCandle): Candle {
  return { tf: r.tf as TF, open: r.o, high: r.h, low: r.l, close: r.c, open_time: r.t };
}

export type FeedStatus = 'idle' | 'live' | 'error';

/**
 * Polls /api/candles every 30s.
 * Calls onCandles() with any bars newer than the last seen timestamp per TF.
 * Returns feedStatus for UI display.
 */
export function useMarketCandles(onCandles: (candles: Candle[]) => void): FeedStatus {
  const lastSeen   = useRef<Map<string, number>>(new Map());
  const onCandlesR = useRef(onCandles);
  onCandlesR.current = onCandles;

  const [status, setStatus] = useState<FeedStatus>('idle');

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch('/api/candles', { cache: 'no-store' });
        if (!res.ok || !alive) { setStatus('error'); return; }

        const data: RawCandle[] = await res.json();
        if (!Array.isArray(data)) { setStatus('error'); return; }

        const fresh: Candle[] = [];
        for (const r of data) {
          if (!VALID_TFS.has(r.tf)) continue;
          const seen = lastSeen.current.get(r.tf) ?? 0;
          if (r.t > seen) {
            lastSeen.current.set(r.tf, r.t);
            fresh.push(toEngineCandle(r));
          }
        }

        if (fresh.length > 0) {
          fresh.sort((a, b) => a.open_time - b.open_time);
          if (alive) {
            setStatus('live');
            onCandlesR.current(fresh);
          }
        } else if (alive && status !== 'live') {
          // Data came back but nothing new — still mark live (market closed / no new bars)
          setStatus('live');
        }
      } catch {
        if (alive) setStatus('error');
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return status;
}
