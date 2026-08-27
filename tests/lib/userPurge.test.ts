// Deleting an account deletes what the account wrote.
//
// The handler removed the `profiles` row and nothing else. Twenty-four tables
// are keyed by clerk_id, and account deletion cleared one of them — so every
// trade, notebook entry, embedding, daily insight, behaviour finding, coach
// conversation, rule and setup a trader had ever written stayed in the
// database after they asked for it to be gone.
//
// Found by tracing ten journal rows belonging to a clerk_id with no profile:
// an account somebody deleted, whose journal was still sitting there.
//
// These tests are about the list and the order, which are the two things a
// reviewer cannot check by reading the handler.

import { describe, it, expect } from 'vitest';
import { __testing } from '../../app/api/webhooks/clerk/route';

const TABLES = __testing.USER_TABLES as readonly string[];

/** Every table in the schema that carries a clerk_id column. Kept here as a
 *  literal so adding a user-scoped table to the database and forgetting to
 *  purge it fails a test rather than leaking quietly. */
const CLERK_SCOPED = [
  'ai_insight_history', 'ai_usage_log', 'behavior_finding_events', 'behavior_findings',
  'coach_chats', 'coach_generation_fallback', 'daily_insights', 'intelligence_trades',
  'journal_trades', 'notebook_chunks', 'notebook_entries', 'pattern_memory',
  'processing_jobs', 'profiles', 'rate_limits', 'rule_violations', 'setups',
  'trader_hypotheses', 'trader_profiles', 'trades', 'trading_rules',
  'user_collections', 'user_preferences', 'user_profile', 'weekly_ai_reports',
];

describe('the purge list', () => {
  it('covers every table keyed to a trader', () => {
    const missing = CLERK_SCOPED.filter(t => !TABLES.includes(t));
    expect(missing, `not purged: ${missing.join(', ')}`).toEqual([]);
  });

  it('names no table twice', () => {
    expect(new Set(TABLES).size).toBe(TABLES.length);
  });

  it('purges the journal and its mirror alike', () => {
    // Two tables hold the same trades. Clearing one would leave the analysis
    // layer holding a deleted trader's positions.
    expect(TABLES).toContain('journal_trades');
    expect(TABLES).toContain('intelligence_trades');
  });

  it('purges what the AI wrote about them, not only what they wrote', () => {
    for (const t of ['daily_insights', 'behavior_findings', 'trader_profiles', 'coach_chats']) {
      expect(TABLES, t).toContain(t);
    }
  });
});

describe('the purge order', () => {
  const before = (a: string, b: string) => TABLES.indexOf(a) < TABLES.indexOf(b);

  it('deletes children before their parents', () => {
    // A cascade only fires when the parent goes. Deleting the parent first
    // works; deleting it last leaves the child orphaned if the run stops.
    expect(before('notebook_chunks', 'notebook_entries')).toBe(true);
    expect(before('behavior_finding_events', 'behavior_findings')).toBe(true);
    expect(before('rule_violations', 'trading_rules')).toBe(true);
  });

  it('deletes the profile last', () => {
    // THE MARKER. While the profile exists the purge is unfinished, so an
    // interrupted run leaves something the retry can recognise.
    expect(TABLES[TABLES.length - 1]).toBe('profiles');
  });
});
