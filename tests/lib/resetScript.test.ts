// The account-reset script, checked against the list of everything a trader owns.
//
// WHY THIS TEST EXISTS
//
// supabase-reset-account.sql deletes a trader's journal and everything the AI
// built from it, while deliberately keeping their configuration, their written
// notes, and their billing. Which side of that line a table falls on is a
// judgement, and a judgement made once is a judgement that rots: the next AI
// table added to the product would sit in neither list, survive the reset, and
// go on asserting things about trades that no longer exist. That is the exact
// failure the script was written to prevent, reappearing one table at a time.
//
// So the script is checked against USER_TABLES in the Clerk purge route, which
// is the codebase's own answer to "what belongs to a trader". Every table there
// must be either deleted by the script or named on a KEEPS line in it.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

const reset = readFileSync('supabase-reset-account.sql', 'utf8');
const webhook = readFileSync('app/api/webhooks/clerk/route.ts', 'utf8');
const localOwner = readFileSync('app/lib/localOwner.ts', 'utf8');

/** The purge route's list — the authoritative "everything keyed to a trader". */
const userTables: string[] = (() => {
  const start = webhook.indexOf('const USER_TABLES');
  const end = webhook.indexOf('] as const;', start);
  return [...webhook.slice(start, end).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
})();

const deleted = new Set([...reset.matchAll(/delete from (\w+)/g)].map(m => m[1]));
const kept = new Set(
  [...reset.matchAll(/-- KEEPS: (.+)/g)].flatMap(m => m[1].trim().split(/\s+/)),
);

describe('coverage', () => {
  it('reads a non-trivial purge list', () => {
    expect(userTables.length).toBeGreaterThan(20);
    expect(userTables).toContain('journal_trades');
  });

  it('accounts for every table a trader owns', () => {
    const unaccounted = userTables.filter(t => !deleted.has(t) && !kept.has(t));
    expect(unaccounted, `neither deleted nor kept: ${unaccounted.join(', ')}`).toEqual([]);
  });

  it('never both deletes and keeps the same table', () => {
    const both = userTables.filter(t => deleted.has(t) && kept.has(t));
    expect(both, `contradictory: ${both.join(', ')}`).toEqual([]);
  });
});

describe('what must go', () => {
  // The trades, and everything the AI wrote about them. Leaving any one of
  // these behind means the product keeps making claims about a journal that
  // was deleted.
  const mustDelete = [
    'journal_trades', 'intelligence_trades', 'trades', 'rule_violations',
    'trader_profiles', 'user_profile', 'pattern_memory', 'trader_hypotheses',
    'weekly_ai_reports', 'ai_insight_history',
    'behavior_findings', 'behavior_finding_events',
    'daily_insights', 'processing_jobs',
  ];
  for (const t of mustDelete) {
    it(`deletes ${t}`, () => expect(deleted.has(t)).toBe(true));
  }

  it('deletes behaviour events before the findings they hang off', () => {
    // The foreign key cascades, but only for rows whose finding still exists.
    // An event orphaned by an earlier partial cleanup would survive it.
    expect(reset.indexOf('delete from behavior_finding_events'))
      .toBeLessThan(reset.indexOf('delete from behavior_findings'));
  });

  it('clears the job queue, so nothing regenerates tonight', () => {
    expect(deleted.has('processing_jobs')).toBe(true);
  });
});

describe('what must stay', () => {
  const mustKeep = ['payment_requests', 'profiles', 'notebook_entries', 'ai_usage_log', 'user_collections'];
  for (const t of mustKeep) {
    it(`does not delete ${t}`, () => expect(deleted.has(t)).toBe(false));
  }
});

describe('the guards on the destructive block', () => {
  it('refuses on anything other than exactly one matching account', () => {
    // The failure mode of a typo has to be "nothing happened", never "the
    // wrong account". A bare `where clerk_id = (select …)` on a missing email
    // silently matches nothing; on a duplicated one it raises mid-delete.
    expect(reset).toContain('if found <> 1 then');
    expect(reset).toContain('raise exception');
  });

  it('runs the deletes inside one block, so it is all or nothing', () => {
    expect(reset).toContain('do $$');
    expect(reset).toContain('end $$;');
  });

  it('shows the counts before touching anything', () => {
    // The section banners, not the words: the header warns about STEP 2
    // before STEP 1 is introduced, which is correct prose and a false match.
    expect(reset.indexOf('══ STEP 1')).toBeGreaterThan(-1);
    expect(reset.indexOf('══ STEP 1')).toBeLessThan(reset.indexOf('══ STEP 2'));
    expect(reset).toContain('READ-ONLY');
  });
});

describe('the half that is not SQL', () => {
  it('bumps the cache epoch, or every device restores the deleted trades', () => {
    // Hydration reads "the cloud is missing what I have" as an outage rather
    // than a deletion — correctly, for an offline-first journal. Without the
    // bump the next page load pushes the whole journal back up.
    expect(localOwner).toContain('export const CACHE_EPOCH = 4;');
    expect(localOwner).toContain('EPOCH 4');
    expect(localOwner).toContain('supabase-reset-account.sql');
  });

  it('says so in the script itself, where the operator will read it', () => {
    expect(reset).toContain('CACHE_EPOCH');
    expect(reset).toContain('localOwner.ts');
  });
});
