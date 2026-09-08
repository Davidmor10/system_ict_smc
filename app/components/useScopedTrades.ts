'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The trades a screen is allowed to show.
//
// Eight screens each ran their own load-then-hydrate pair and then computed on
// whatever came back. Scoping them to a portfolio one file at a time would
// have worked until the ninth screen was written, and a screen that forgets to
// scope does not break — it silently averages two accounts together, which is
// the one failure this whole feature exists to prevent.
//
// So the scoping lives here, and screens ask for trades rather than loading
// them. `all` is available for the two callers that genuinely need the whole
// journal: the importer, which checks for duplicates across every portfolio
// because an order id is unique everywhere, and the first-run gate, which asks
// whether this account has ever logged anything.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import { hydrateTradesFromCloud, loadTrades, saveTrades, type TradeEntry } from '../lib/journal';
import { scopeTrades } from '../lib/portfolio/scope';
import { usePortfolios } from './PortfolioProvider';

export interface ScopedTrades {
  /** The selected portfolio's trades. What every screen should render. */
  trades: TradeEntry[];
  /** Every trade on the account, whatever portfolio it belongs to.
   *
   *  WRITE FROM THIS ONE, NEVER FROM `trades`.
   *
   *  saveTrades replaces the journal wholesale, and softDelete calls it
   *  internally. Handing either the scoped subset persists one portfolio's
   *  trades as the entire journal and deletes every other portfolio's without
   *  a word. The type system caught exactly that here when the journal page's
   *  save and delete were converted, and it is the reason this hook exposes a
   *  writer at all rather than leaving callers to reach for saveTrades. */
  all: TradeEntry[];
  /** False until the cloud copy has answered. */
  ready: boolean;
  /** Persist the WHOLE journal and update state. Takes the complete list. */
  saveAll: (next: TradeEntry[]) => void;
  /** Update state only — for a caller whose helper has already persisted,
   *  which softDelete does. */
  adoptAll: (next: TradeEntry[]) => void;
}

export function useScopedTrades(): ScopedTrades {
  const [all, setAll] = useState<TradeEntry[]>([]);
  const [ready, setReady] = useState(false);
  const { portfolios, selected } = usePortfolios();

  useEffect(() => {
    // Local first — instant, and correct until the cloud disagrees. Read in an
    // effect rather than a useState initializer: this component is server-
    // rendered too, and seeding from localStorage there is what produced a
    // hydration mismatch in PortfolioProvider.
    setAll(loadTrades());
    let alive = true;
    hydrateTradesFromCloud()
      .then(merged => { if (alive && merged) setAll(merged); })
      .catch(() => { /* the local copy stands */ })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  const trades = useMemo(
    () => scopeTrades(all, portfolios, selected?.id ?? null),
    [all, portfolios, selected],
  );

  const saveAll = useCallback((next: TradeEntry[]) => {
    saveTrades(next);
    setAll(next);
  }, []);

  const adoptAll = useCallback((next: TradeEntry[]) => setAll(next), []);

  return { trades, all, ready, saveAll, adoptAll };
}
