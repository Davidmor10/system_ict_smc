// ─────────────────────────────────────────────────────────────────────────────
// The trader's own written material, read server-side.
//
// Rules, rule breaches and the daily plan all live in `user_collections` — the
// generic per-user store the browser syncs its localStorage lists into. Until
// now nothing on the server read any of it, which is why the coach could say
// "you deviated from your rules" but never "the rule you keep breaking is the
// one about waiting for confirmation": the trader ticks WHICH rule in the trade
// form, that tick has been stored for weeks, and no analysis had ever opened
// the drawer.
//
// Everything here is defensive. These rows are written by the client, so a
// half-migrated shape is a normal state, not an exception — a malformed
// collection costs its own block in the prompt and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

import { getClient, requireClerkId } from './client';
import { logger } from '../../logger';

export interface StoredRule { id: string; title?: string; text?: string; deleted?: boolean }
export interface StoredBreach { id?: string; ruleId: string; date: string; deleted?: boolean }
export interface StoredDayPlan { id: string; bias?: string; note?: string; at?: number; deleted?: boolean }

async function readCollection(clerkId: string, kind: string): Promise<unknown[]> {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient()
    .from('user_collections')
    .select('data')
    .eq('clerk_id', cid)
    .eq('kind', kind)
    .maybeSingle();
  if (error) throw error;
  const rows = (data as { data?: unknown } | null)?.data;
  return Array.isArray(rows) ? rows : [];
}

/** What the trader wrote as their own rules, and which of them they ticked as
 *  broken. Returned together because one is meaningless without the other: a
 *  breach carries a rule id, and a rule id the trader cannot read is not a
 *  finding, it is a database key. */
export async function loadRuleBreaches(clerkId: string): Promise<{
  rules: Map<string, string>;
  breaches: StoredBreach[];
}> {
  try {
    const [rawRules, rawBreaches] = await Promise.all([
      readCollection(clerkId, 'rules'),
      readCollection(clerkId, 'violations'),
    ]);

    const rules = new Map<string, string>();
    for (const r of rawRules as StoredRule[]) {
      if (!r || typeof r.id !== 'string' || r.deleted) continue;
      const title = (r.title ?? r.text ?? '').trim();
      if (title) rules.set(r.id, title);
    }

    const breaches = (rawBreaches as StoredBreach[]).filter(
      b => b && !b.deleted && typeof b.ruleId === 'string' && typeof b.date === 'string',
    );

    return { rules, breaches };
  } catch (err) {
    logger.warn('rule breaches unavailable', { clerkId, error: err instanceof Error ? err.message : String(err) });
    return { rules: new Map(), breaches: [] };
  }
}

/** The direction the trader declared for a given day, and why.
 *
 *  The reason is the half that matters here. A direction on its own is already
 *  on every trade of that day; the sentence behind it — "sweep of Asia's high,
 *  daily gap still open" — is the only record of what they were thinking
 *  before the session, and it is the one thing in the journal that can be read
 *  back against what the market actually did. */
export async function loadDayPlan(clerkId: string, dateIso: string): Promise<StoredDayPlan | null> {
  try {
    const rows = await readCollection(clerkId, 'dayplans');
    const found = (rows as StoredDayPlan[]).find(p => p && !p.deleted && p.id === dateIso);
    return found ?? null;
  } catch (err) {
    logger.warn('day plan unavailable', { clerkId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
