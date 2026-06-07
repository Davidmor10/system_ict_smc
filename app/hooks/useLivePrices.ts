'use client';

import { useState, useEffect, useRef } from 'react';

export interface LiveQuote {
  price:  number;
  change: number;
  pct:    number;
  high:   number;
  low:    number;
  flash:  'up' | 'down' | null;
}

export interface LivePrices {
  es:    LiveQuote;
  nq:    LiveQuote;
  ready: boolean;
}

const ZERO: LiveQuote = { price: 0, change: 0, pct: 0, high: 0, low: 0, flash: null };

interface RawQuote { symbol: string; price: number; change: number; pct: number; high: number; low: number; }

export function useLivePrices(): LivePrices {
  const [state, setState] = useState<LivePrices>({ es: ZERO, nq: ZERO, ready: false });
  const prev = useRef({ es: 0, nq: 0 });

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch('/api/quotes', { cache: 'no-store' });
        if (!res.ok || !alive) return;
        const data: RawQuote[] = await res.json();
        if (!Array.isArray(data)) return;

        const esQ = data.find(q => q.symbol === 'ES=F');
        const nqQ = data.find(q => q.symbol === 'NQ=F');

        const esFlash: LiveQuote['flash'] = esQ && prev.current.es
          ? esQ.price > prev.current.es ? 'up' : esQ.price < prev.current.es ? 'down' : null
          : null;
        const nqFlash: LiveQuote['flash'] = nqQ && prev.current.nq
          ? nqQ.price > prev.current.nq ? 'up' : nqQ.price < prev.current.nq ? 'down' : null
          : null;

        if (esQ) prev.current.es = esQ.price;
        if (nqQ) prev.current.nq = nqQ.price;

        setState({
          es:    esQ ? { ...esQ, flash: esFlash } : ZERO,
          nq:    nqQ ? { ...nqQ, flash: nqFlash } : ZERO,
          ready: !!(esQ || nqQ),
        });

        if (esFlash || nqFlash) {
          setTimeout(() => {
            if (alive) setState(s => ({
              ...s,
              es: { ...s.es, flash: null },
              nq: { ...s.nq, flash: null },
            }));
          }, 600);
        }
      } catch {
        // keep last known values on network error
      }
    }

    poll();
    const id = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return state;
}
