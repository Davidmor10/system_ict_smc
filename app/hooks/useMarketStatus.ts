'use client';

import { useEffect, useState } from 'react';
import { getMarketStatus, type MarketStatus } from '../lib/marketStatus';

/**
 * Reactive wrapper around getMarketStatus(). Re-evaluates on a low-frequency
 * interval so the UI flips across the weekend boundary on its own — no reload.
 *
 * Best-practice notes:
 *  - Non-blocking: a single timer, no synchronous polling on render.
 *  - Leak-free: the interval is cleared on unmount.
 *  - Cheap: day-of-week rarely changes, so a 60s cadence is ample.
 */
export function useMarketStatus(pollMs = 60_000): MarketStatus {
  const [status, setStatus] = useState<MarketStatus>(() => getMarketStatus());

  useEffect(() => {
    const tick = () => setStatus(getMarketStatus());
    tick(); // re-sync immediately on mount (covers any SSR/hydration drift)
    const id = setInterval(tick, pollMs);
    return () => clearInterval(id);
  }, [pollMs]);

  return status;
}
