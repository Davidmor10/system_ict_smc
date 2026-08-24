import { describe, expect, it } from 'vitest';
import { requireClerkId } from '../../app/lib/coach-pipeline/db/client';
import * as trades   from '../../app/lib/coach-pipeline/db/trades';
import * as notebook from '../../app/lib/coach-pipeline/db/notebook';
import * as profile  from '../../app/lib/coach-pipeline/db/profile';
import * as jobs     from '../../app/lib/coach-pipeline/db/jobs';
import * as usage    from '../../app/lib/coach-pipeline/db/usage';
import * as insights from '../../app/lib/coach-pipeline/db/insights';

// ─────────────────────────────────────────────────────────────────────────────
// The one non-negotiable invariant of the coach-pipeline DB layer: every helper
// that scopes to a single user MUST reject an empty/nullish clerk_id BEFORE it
// touches Supabase. The alternative — an unfiltered query hitting a Supabase
// client mid-request — would return other users' rows. RLS is the backstop but
// service-role bypasses it, so this in-code guard is the actual door.
//
// This test cannot verify SQL correctness (that needs a real DB). It CAN
// verify that every helper calls requireClerkId first — the throw happens
// before any await, so no network call escapes.
// ─────────────────────────────────────────────────────────────────────────────

describe('requireClerkId', () => {
  it('accepts a normal id', () => {
    expect(requireClerkId('user_abc123')).toBe('user_abc123');
  });

  it('trims whitespace', () => {
    expect(requireClerkId('  user_abc  ')).toBe('user_abc');
  });

  it('rejects empty string', () => {
    expect(() => requireClerkId('')).toThrow(/clerk_id is required/);
  });

  it('rejects whitespace-only', () => {
    expect(() => requireClerkId('   ')).toThrow(/clerk_id is required/);
  });

  it('rejects null', () => {
    expect(() => requireClerkId(null)).toThrow(/clerk_id is required/);
  });

  it('rejects undefined', () => {
    expect(() => requireClerkId(undefined)).toThrow(/clerk_id is required/);
  });
});

// Every helper that takes a clerkId as its first arg must reject an empty
// string. If a new helper is added to a db/*.ts file, add it here or delete it.
// Failure here = an unscoped query is possible — treat as a security bug.
const scopedHelpers: Array<[string, (arg: string, ...rest: unknown[]) => Promise<unknown>]> = [
  ['trades.listUnprocessedTrades',   (id) => trades.listUnprocessedTrades(id)],
  ['trades.countTradesSince',        (id) => trades.countTradesSince(id, new Date().toISOString())],
  ['trades.listTradesForDate',       (id) => trades.listTradesForDate(id, '2026-08-07')],
  ['trades.listLateLoggedTrades',    (id) => trades.listLateLoggedTrades(id, '2026-08-07', '2026-08-01T00:00:00Z')],
  ['trades.markTradesProcessed',     (id) => trades.markTradesProcessed(id, ['x'], 1)],
  ['notebook.listEntriesNeedingEmbed', (id) => notebook.listEntriesNeedingEmbed(id)],
  ['notebook.getEntry',              (id) => notebook.getEntry(id, 'x')],
  ['notebook.markEntryEmbedded',     (id) => notebook.markEntryEmbedded(id, 'x', 'hash')],
  ['notebook.replaceChunks',         (id) => notebook.replaceChunks(id, 'x', [])],
  ['notebook.searchChunks',          (id) => notebook.searchChunks(id, [0.1])],
  ['profile.getUserProfile',         (id) => profile.getUserProfile(id)],
  ['profile.getRefreshSignals',      (id) => profile.getRefreshSignals(id)],
  ['jobs.enqueueJob',                (id) => jobs.enqueueJob({ clerkId: id, jobType: 'daily_insight' })],
  ['jobs.listRecentJobs',            (id) => jobs.listRecentJobs(id)],
  ['usage.sumUserMonthlyCost',       (id) => usage.sumUserMonthlyCost(id, new Date())],
  ['insights.getInsightForDate',     (id) => insights.getInsightForDate(id, '2026-08-07')],
  ['insights.listRecentInsights',    (id) => insights.listRecentInsights(id)],
  ['insights.markInsightRead',       (id) => insights.markInsightRead(id, 'x')],
  ['insights.setInsightReaction',    (id) => insights.setInsightReaction(id, 'x', 'helpful')],
];

describe('DB helpers reject empty clerk_id', () => {
  for (const [name, call] of scopedHelpers) {
    it(`${name} throws on empty string`, async () => {
      await expect(call('')).rejects.toThrow(/clerk_id is required/);
    });
    it(`${name} throws on whitespace`, async () => {
      await expect(call('   ')).rejects.toThrow(/clerk_id is required/);
    });
  }
});

// upsertUserProfile takes an input object — special-case it.
describe('profile.upsertUserProfile rejects empty clerk_id', () => {
  it('throws before hitting Supabase', async () => {
    await expect(profile.upsertUserProfile('', {
      statistical:       {},
      behavioral:        {},
      narrative_summary: '',
      schema_version:    1,
      analyzer_version:  1,
      last_analyzed_at:  new Date(),
      last_trade_included_id: null,
      last_note_included_id:  null,
    })).rejects.toThrow(/clerk_id is required/);
  });
});
