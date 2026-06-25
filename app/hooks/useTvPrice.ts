'use client';

import { useEffect, useState } from 'react';

interface TVCandle { tf: string; o: number; h: number; l: number; c: number; sess: string; t: number; }

export interface TvPrice {
  price:     number | null;
  open:      number | null;
  high:      number | null;
  low:       number | null;
  change:    number | null;
  changePct: number | null;
  tf:        string | null;
  sess:      string | null;
  barTime:   number | null;
  updatedAt: number | null;
  status:    'idle' | 'receiving' | 'error';
}

const EMPTY: TvPrice = {
  price: null, open: null, high: null, low: null,
  change: null, changePct: null,
  tf: null, sess: null, barTime: null, updatedAt: null,
  status: 'idle',
};

export function useTvPrice(): TvPrice {
  const [data, setData] = useState<TvPrice>(EMPTY);

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch('/api/tv-webhook', { cache: 'no-store' });
        if (!res.ok || !alive) return;
        const json: { candles: TVCandle[] } = await res.json();
        const candles = Array.isArray(json.candles) ? json.candles : [];
        if (!candles.length) return;

        const latest = candles.reduce((a, b) => a.t > b.t ? a : b);
        const change    = latest.c - latest.o;
        const changePct = latest.o !== 0 ? (change / latest.o) * 100 : 0;

        if (alive) setData({
          price: latest.c, open: latest.o, high: latest.h, low: latest.l,
          change, changePct,
          tf: latest.tf, sess: latest.sess,
          barTime: latest.t, updatedAt: Date.now(),
          status: 'receiving',
        });
      } catch {
        if (alive) setData(d => ({ ...d, status: 'error' }));
      }
    }

    poll();
    const id = setInterval(poll, 2_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return data;
}
