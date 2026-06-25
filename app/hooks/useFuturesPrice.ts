'use client';

import { useEffect, useState } from 'react';

interface RawCandle { symbol: string; tf: string; t: number; o: number; h: number; l: number; c: number; }

export interface FuturePrice {
  price:     number | null;
  open:      number | null;
  high:      number | null;
  low:       number | null;
  change:    number | null;
  changePct: number | null;
  barTime:   number | null;
  updatedAt: number | null;
}

export interface FuturesPrices {
  es:     FuturePrice;
  nq:     FuturePrice;
  status: 'idle' | 'live' | 'error';
}

const EMPTY_PRICE: FuturePrice = {
  price: null, open: null, high: null, low: null,
  change: null, changePct: null, barTime: null, updatedAt: null,
};

function toPrice(candle: RawCandle): FuturePrice {
  const change    = candle.c - candle.o;
  const changePct = candle.o !== 0 ? (change / candle.o) * 100 : 0;
  return {
    price: candle.c, open: candle.o, high: candle.h, low: candle.l,
    change, changePct, barTime: candle.t, updatedAt: Date.now(),
  };
}

export function useFuturesPrice(): FuturesPrices {
  const [state, setState] = useState<FuturesPrices>({
    es: EMPTY_PRICE, nq: EMPTY_PRICE, status: 'idle',
  });

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch('/api/candles', { cache: 'no-store' });
        if (!res.ok || !alive) { setState(s => ({ ...s, status: 'error' })); return; }

        const data: RawCandle[] = await res.json();
        if (!Array.isArray(data) || !alive) return;

        // For each symbol, find the most recent 1m candle
        const latest: Record<string, RawCandle> = {};
        for (const c of data) {
          if (c.tf !== '1m') continue;
          const sym = c.symbol?.toUpperCase();
          if (!sym) continue;
          if (!latest[sym] || c.t > latest[sym].t) latest[sym] = c;
        }

        const esCandle = latest['ES=F'] ?? latest['ES'] ?? latest['^GSPC'];
        const nqCandle = latest['NQ=F'] ?? latest['NQ'] ?? latest['^IXIC'];

        if (alive) setState({
          es:     esCandle ? toPrice(esCandle) : EMPTY_PRICE,
          nq:     nqCandle ? toPrice(nqCandle) : EMPTY_PRICE,
          status: (esCandle || nqCandle) ? 'live' : 'idle',
        });
      } catch {
        if (alive) setState(s => ({ ...s, status: 'error' }));
      }
    }

    poll();
    const id = setInterval(poll, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return state;
}
