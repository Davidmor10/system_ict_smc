'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Loading, saving and selecting portfolios on the client.
//
// A synced list like the playbook and the rules: hydrated from the cloud on
// load, merged newest-wins, tombstoned on delete so the row cannot be
// resurrected by another device. See lib/sync/collections and lib/sync/merge.
//
// The SELECTION is deliberately not part of that list. It is per device — a
// phone and a desktop can sit on different portfolios without fighting over
// which one is "current" — so it lives under the owner envelope like any other
// local preference and never leaves the browser.
// ─────────────────────────────────────────────────────────────────────────────

import { commitList, hydrateList } from '../sync/collections';
import { readOwned, writeOwned } from '../sync/owned';
import {
  PORTFOLIOS_KEY, PORTFOLIOS_KIND, SELECTED_PORTFOLIO_KEY,
  normalizePortfolio, type Portfolio,
} from './types';

/** Everything stored locally, right now, without waiting for the network.
 *
 *  Synchronous on purpose: the sidebar renders on first paint and a switcher
 *  that appears a beat later reads as a bug. The cloud copy arrives after and
 *  corrects it. */
export function loadPortfoliosLocal(): Portfolio[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = readOwned<unknown[]>(PORTFOLIOS_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizePortfolio).filter((p): p is Portfolio => p !== null && !p.deleted);
  } catch {
    return [];
  }
}

/** The full list, cloud-merged. Tombstones are dropped on the way out — the
 *  store keeps them, the caller never sees them. */
export async function hydratePortfolios(): Promise<Portfolio[]> {
  const rows = await hydrateList<Portfolio>(PORTFOLIOS_KIND, PORTFOLIOS_KEY);
  return rows.map(normalizePortfolio).filter((p): p is Portfolio => p !== null);
}

/** Persist the visible list. `commitList` stamps what changed and tombstones
 *  what the caller dropped, so a delete propagates instead of a peer bringing
 *  the portfolio back on the next merge. */
export async function savePortfolios(next: Portfolio[]): Promise<void> {
  await commitList<Portfolio>(PORTFOLIOS_KIND, PORTFOLIOS_KEY, next);
}

// ── The selection ────────────────────────────────────────────────────────────

export function readSelectedId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = readOwned<string>(SELECTED_PORTFOLIO_KEY);
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

export function writeSelectedId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    writeOwned(SELECTED_PORTFOLIO_KEY, id ?? '');
    // Every screen in the app is scoped to one portfolio, and most of them are
    // rendered by components that have already read it. A custom event is what
    // lets the switcher change the answer without a reload.
    window.dispatchEvent(new CustomEvent(PORTFOLIO_CHANGED));
  } catch { /* a selection that cannot be stored still applies to this tab */ }
}

/** Fired when the selected portfolio changes, in this tab. */
export const PORTFOLIO_CHANGED = 'onyx:portfolio-changed';
