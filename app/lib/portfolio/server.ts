// ─────────────────────────────────────────────────────────────────────────────
// Which portfolio the server is analysing, and which one adopts the orphans.
//
// The portfolios themselves live in `user_collections` as a JSON document,
// written by the browser like every other synced collection. The server has no
// separate table for them and does not need one — it needs two answers:
//
//   · is this portfolio id real, and does it belong to this trader
//   · which portfolio adopts trades that carry no account
//
// The second uses the SAME pure rule as the client (lib/portfolio/scope), so a
// trade cannot appear under one portfolio on screen and be counted under
// another by the nightly pipeline. Two implementations of that rule would
// disagree eventually, and the disagreement would be invisible.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import { adoptingPortfolioId } from './scope';
import { normalizePortfolio, PORTFOLIOS_KIND, type Portfolio } from './types';

export async function listPortfolios(
  supabase: SupabaseClient, clerkId: string,
): Promise<Portfolio[]> {
  const { data, error } = await supabase
    .from('user_collections')
    .select('data')
    .eq('clerk_id', clerkId)
    .eq('kind', PORTFOLIOS_KIND)
    .maybeSingle();
  if (error || !data || !Array.isArray((data as { data?: unknown }).data)) return [];
  return ((data as { data: unknown[] }).data)
    .map(normalizePortfolio)
    .filter((p): p is Portfolio => p !== null && !p.deleted);
}

export interface AccountScope {
  /** The portfolio being analysed, or null when the trader has none. */
  accountId: string | null;
  /** True when this portfolio also owns every trade that carries no account. */
  adoptsUnassigned: boolean;
}

/** Resolve the scope for a request, refusing an id that is not this trader's.
 *
 *  A forged portfolio id can only ever reach rows the caller already owns —
 *  every query is clerk-scoped underneath — but it would let one portfolio's
 *  analysis be written under another's key, which is a way to corrupt a
 *  trader's own record rather than to read someone else's. */
export async function resolveScope(
  supabase: SupabaseClient, clerkId: string, requested: string | null | undefined,
): Promise<AccountScope> {
  const portfolios = await listPortfolios(supabase, clerkId);
  if (portfolios.length === 0) return { accountId: null, adoptsUnassigned: true };

  const adopting = adoptingPortfolioId(portfolios);
  const known = requested && portfolios.some(p => p.id === requested) ? requested : adopting;
  return { accountId: known, adoptsUnassigned: known === adopting };
}

/** Apply a scope to a query over a table with an `account_id` column.
 *
 *  Written as a filter string rather than chained `.eq`s because the
 *  unassigned case is a disjunction, and PostgREST expresses that with `or`. */
export function accountFilter(scope: AccountScope): string | null {
  if (scope.accountId === null) return null;
  return scope.adoptsUnassigned
    ? `account_id.eq.${scope.accountId},account_id.is.null,account_id.eq.`
    : `account_id.eq.${scope.accountId}`;
}

/** The value to WRITE. Never null — the AI tables key on it. */
export function accountKey(scope: AccountScope): string {
  return scope.accountId ?? '';
}
