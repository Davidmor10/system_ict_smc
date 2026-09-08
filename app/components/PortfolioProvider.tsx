'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The portfolio every screen is scoped to, in one place.
//
// Mounted once in the dashboard shell so the list is hydrated once rather than
// by each consumer. The switcher writes here; the pages read.
//
// The local list is read in an effect, NOT in the useState initializer, and
// that distinction is not stylistic. Client components are server-rendered:
// the initializer runs once on the server, where localStorage does not exist
// and the list is empty, and again during hydration, where it is not. Any
// consumer that renders a number off it — the dashboard's opening balance —
// then produced different text on the two passes.
//
// Measured, not reasoned about: React error #418, "the server rendered text
// didn't match", thrown on load with a portfolio in storage.
//
// The cost is one frame showing the fallback balance before the effect lands,
// on a dashboard whose figures count up from zero anyway.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  hydratePortfolios, loadPortfoliosLocal, readSelectedId, savePortfolios,
  writeSelectedId, PORTFOLIO_CHANGED,
} from '../lib/portfolio/store';
import { resolveSelected, type Portfolio } from '../lib/portfolio/types';

interface PortfolioState {
  portfolios: Portfolio[];
  selected: Portfolio | null;
  /** False until the cloud copy has answered. Screens that would otherwise
   *  render "no portfolios yet" must wait for this — offering to connect a
   *  portfolio to someone who already has one is the worst thing this can do. */
  ready: boolean;
  select: (id: string) => void;
  save: (next: Portfolio[]) => Promise<void>;
}

const Ctx = createContext<PortfolioState>({
  portfolios: [], selected: null, ready: false,
  select: () => {}, save: async () => {},
});

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Local first — instant, and correct until the cloud disagrees.
    setPortfolios(loadPortfoliosLocal());
    setSelectedId(readSelectedId());
    let alive = true;
    hydratePortfolios()
      .then(rows => { if (alive) setPortfolios(rows.filter(p => !p.deleted)); })
      .catch(() => { /* the local copy stands */ })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  // Another component in this tab changed the selection.
  useEffect(() => {
    const onChange = () => setSelectedId(readSelectedId());
    window.addEventListener(PORTFOLIO_CHANGED, onChange);
    return () => window.removeEventListener(PORTFOLIO_CHANGED, onChange);
  }, []);

  const select = useCallback((id: string) => {
    writeSelectedId(id);
    setSelectedId(id);
  }, []);

  const save = useCallback(async (next: Portfolio[]) => {
    // Optimistic: the list is the trader's own edit and the write is local
    // first. A failed cloud push is queued, not lost — see lib/sync.
    setPortfolios(next.filter(p => !p.deleted));
    await savePortfolios(next);
  }, []);

  const selected = useMemo(() => resolveSelected(portfolios, selectedId), [portfolios, selectedId]);

  const value = useMemo(
    () => ({ portfolios, selected, ready, select, save }),
    [portfolios, selected, ready, select, save],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePortfolios() {
  return useContext(Ctx);
}
