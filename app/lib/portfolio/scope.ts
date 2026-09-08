// ─────────────────────────────────────────────────────────────────────────────
// Which trades belong to the portfolio you are looking at.
//
// The rule the whole feature rests on: a trader with a $50,000 account and a
// $25,000 account has two records, and averaging them produces a win rate that
// describes neither. Every screen that counts, groups or compares trades goes
// through here first.
//
// THE AWKWARD CASE IS THE TRADE WITH NO PORTFOLIO ON IT
//
// Every trade written from now on carries one — the importer stamps it and the
// form stamps it. But a journal that predates portfolios has none, and there
// are only bad answers to "which account was this in": we do not know, and the
// trader may not either.
//
// It is resolved by assignment rather than by guessing. The oldest portfolio
// adopts them, once, and after that the question never arises again. What this
// must never do is HIDE such a trade: a journal that quietly stops showing you
// trades you logged is the worst outcome available here, worse than filing one
// under the wrong account, because nothing on screen would say so.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry } from '../journal';
import type { Portfolio } from './types';

/** The portfolio that adopts unassigned trades: the oldest one. Deterministic,
 *  and stable as portfolios are added — a rule that picked "the selected one"
 *  would move the same trade between accounts as the trader clicked around. */
export function adoptingPortfolioId(portfolios: readonly Portfolio[]): string | null {
  const live = portfolios.filter(p => !p.deleted);
  if (live.length === 0) return null;
  return [...live].sort((a, b) => a.createdAt - b.createdAt)[0].id;
}

export function scopeTrades(
  trades: readonly TradeEntry[],
  portfolios: readonly Portfolio[],
  selectedId: string | null,
): TradeEntry[] {
  // No portfolio yet — the journal is still one undivided record, and showing
  // it whole is the only honest answer.
  if (!selectedId || portfolios.length === 0) return [...trades];

  const adopts = adoptingPortfolioId(portfolios) === selectedId;
  return trades.filter(t => {
    const owner = t.accountId;
    if (owner) return owner === selectedId;
    return adopts;
  });
}

/** Stamp every unassigned trade with a portfolio.
 *
 *  Run once, when the FIRST portfolio is created: at that moment everything in
 *  the journal was one record, so all of it is that portfolio's. Returns the
 *  trades that changed, empty when there is nothing to do — the caller writes
 *  only when it is not.
 *
 *  Deliberately does NOT re-home a trade that already carries an id. A trade
 *  assigned to a portfolio that was later deleted keeps pointing at it; that
 *  is a fact about the record, and rewriting it here would be this function
 *  quietly moving a trader's history between accounts. */
export function backfillAccountId(
  trades: readonly TradeEntry[], portfolioId: string,
): { changed: boolean; trades: TradeEntry[] } {
  let changed = false;
  const out = trades.map(t => {
    if (t.accountId) return t;
    changed = true;
    return { ...t, accountId: portfolioId, updatedAt: Date.now() };
  });
  return { changed, trades: changed ? out : [...trades] };
}
