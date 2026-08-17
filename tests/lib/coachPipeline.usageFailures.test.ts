// ─────────────────────────────────────────────────────────────────────────────
// recentFailures — the half of the AI ledger the rollup does not answer.
//
// The rollup says how many calls failed. That is one question short of useful:
// three failures a month is a footnote, three TIMEOUTS a month on one model
// means the timeout is mis-sized, and a retired model still being called means
// something never got cleaned up. Same count, three different actions.
//
// The grouping is the whole function, so it is what is tested here: rows are
// read newest-first, and each (model, purpose, error_kind) has to come back
// once, carrying its own count and the timestamp of its most recent occurrence.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';

let rows: Array<Record<string, unknown>> = [];
const captured: Record<string, unknown> = {};

vi.mock('../../app/lib/coach-pipeline/db/client', () => ({
  getClient: () => ({
    from: (table: string) => {
      captured.table = table;
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { captured[`eq:${col}`] = val; return q; },
        gte: (col: string, val: unknown) => { captured[`gte:${col}`] = val; return q; },
        order: (col: string, opts: { ascending?: boolean }) => {
          captured.orderBy = col; captured.ascending = opts?.ascending; return q;
        },
        limit: (n: number) => { captured.limit = n; return Promise.resolve({ data: rows, error: null }); },
      };
      return q;
    },
  }),
  requireClerkId: (id: string) => id,
}));

const { recentFailures } = await import('../../app/lib/coach-pipeline/db/usage');

const F = (model: string, purpose: string, kind: string | null, at: string) => ({
  model, purpose, error_kind: kind, created_at: at,
});

describe('recentFailures', () => {
  it('reads only failed rows, newest first, within the window', async () => {
    rows = [];
    await recentFailures('2026-08-01T00:00:00Z');
    expect(captured.table).toBe('ai_usage_log');
    expect(captured['eq:ok']).toBe(false);
    expect(captured['gte:created_at']).toBe('2026-08-01T00:00:00Z');
    expect(captured.ascending).toBe(false);
  });

  it('collapses repeats into one row carrying the count', async () => {
    rows = [
      F('claude-sonnet-5', 'daily_insight', 'timeout', '2026-08-15T01:00:00Z'),
      F('claude-sonnet-5', 'daily_insight', 'timeout', '2026-08-09T01:00:00Z'),
      F('claude-sonnet-5', 'daily_insight', 'timeout', '2026-08-03T01:00:00Z'),
    ];
    const out = await recentFailures('2026-08-01T00:00:00Z');
    expect(out).toHaveLength(1);
    expect(out[0].calls).toBe(3);
    // Newest, not whichever arrived last — the answer to "is this still
    // happening?" is the only reason the timestamp is here at all.
    expect(out[0].lastAt).toBe('2026-08-15T01:00:00Z');
  });

  it('keeps different failure kinds apart on the same model', async () => {
    // The distinction the whole endpoint exists for: a mis-sized timeout and an
    // exhausted quota are the same number in the rollup and different problems.
    rows = [
      F('claude-sonnet-5', 'daily_insight', 'rate_limit', '2026-08-16T01:00:00Z'),
      F('claude-sonnet-5', 'daily_insight', 'timeout', '2026-08-15T01:00:00Z'),
      F('claude-sonnet-5', 'daily_insight', 'timeout', '2026-08-14T01:00:00Z'),
    ];
    const out = await recentFailures('2026-08-01T00:00:00Z');
    expect(out.map(g => [g.errorKind, g.calls])).toEqual([['timeout', 2], ['rate_limit', 1]]);
  });

  it('separates the same error on different models and purposes', async () => {
    rows = [
      F('google/text-embedding-004', 'retrieval_query', 'embed_failed', '2026-08-02T01:00:00Z'),
      F('gemini-2.5-flash', 'daily_insight', 'embed_failed', '2026-08-01T01:00:00Z'),
    ];
    expect(await recentFailures('2026-08-01T00:00:00Z')).toHaveLength(2);
  });

  it('labels a missing error kind rather than dropping the row', async () => {
    // A failure with no recorded reason is still a failure, and hiding it
    // would make the counts here disagree with the rollup's `failed`.
    rows = [F('claude-sonnet-5', 'daily_insight', null, '2026-08-15T01:00:00Z')];
    const out = await recentFailures('2026-08-01T00:00:00Z');
    expect(out[0].errorKind).toBe('unknown');
  });

  it('returns an empty list, never a throw, when the read fails', async () => {
    rows = null as unknown as [];
    expect(await recentFailures('2026-08-01T00:00:00Z')).toEqual([]);
  });
});
