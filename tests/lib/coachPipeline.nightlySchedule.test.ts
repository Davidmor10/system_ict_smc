// ─────────────────────────────────────────────────────────────────────────────
// What the nightly cron actually queues.
//
// The descriptive stack — trader profile, pattern memory, hypothesis, edge and
// learning scores — is written by one function, and of the entry points that
// reach it exactly one was wired into the app: the weekly report route. Nothing
// scheduled ever ran it. Its `profile_refresh` job type had been declared since
// the queue was built and the worker's own comment said "no runner yet".
//
// So everything that stack stores about time was measured from an arbitrary
// point: a pattern marked `weakening` meant weaker than the last time the
// trader happened to open a panel.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { __setClientForTests } from '../../app/lib/coach-pipeline/db/client';

vi.mock('../../app/lib/coach-pipeline/db/flags', () => ({
  flags: {
    aiPipelineEnabled:   async () => true,
    idleSkipDays:        async () => 30,
    spreadWindowMinutes: async () => 60,
  },
}));

const { scheduleNightlyJobs } = await import('../../app/lib/coach-pipeline/pipelines/scheduleNightlyJobs');

interface Insert { job_type: string; clerk_id: string; scheduled_at: string }

/** Just enough of the client for the enqueue loop: the active-trader read, the
 *  plan-tier read, and the insert we are here to look at. */
function fakeClient(inserts: Insert[]): SupabaseClient {
  const builder = (table: string) => ({
    select() { return this; },
    gt()     { return this; },
    is()     { return this; },
    in()     { return this; },
    order()  { return this; },
    range(from: number) {
      if (table === 'intelligence_trades') {
        return Promise.resolve({ data: from === 0 ? [{ clerk_id: 'user_A' }] : [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    then(resolve: (v: { data: unknown; error: null }) => unknown) {
      // profiles: the plan-tier lookup awaits the builder directly.
      return Promise.resolve({
        data: table === 'profiles' ? [{ clerk_id: 'user_A', role: 'deluxe', email: 'a@example.com' }] : [],
        error: null,
      }).then(resolve);
    },
    insert(row: Insert) {
      inserts.push(row);
      return { select: () => ({ maybeSingle: async () => ({ data: { ...row, id: `job_${inserts.length}` }, error: null }) }) };
    },
  });
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient;
}

let inserts: Insert[];
beforeEach(() => { inserts = []; __setClientForTests(fakeClient(inserts)); });
afterEach(() => { __setClientForTests(null); });

describe('scheduleNightlyJobs', () => {
  it('queues the descriptive refresh alongside the insight', async () => {
    const result = await scheduleNightlyJobs(new Date('2026-08-26T01:00:00Z'), 0);
    expect(result.eligible).toBe(1);
    expect(inserts.map(i => i.job_type)).toEqual(['daily_insight', 'profile_refresh']);
    expect(result.enqueued).toBe(2);
  });

  it('puts the note the trader reads ahead of the profile rebuild', async () => {
    await scheduleNightlyJobs(new Date('2026-08-26T01:00:00Z'), 0);
    const [insight, refresh] = inserts;
    expect(Date.parse(refresh.scheduled_at)).toBeGreaterThan(Date.parse(insight.scheduled_at));
    // …and by little enough that the same drain still reaches it. This cron
    // runs once a day and drains its own queue inline for about forty-five
    // seconds; anything not due inside that window waits a full day.
    expect(Date.parse(refresh.scheduled_at) - Date.parse(insight.scheduled_at)).toBeLessThan(45_000);
  });
});
