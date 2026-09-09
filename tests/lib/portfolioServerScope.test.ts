// The server's answer to "which portfolio am I analysing".
//
// The rule that matters most here is that it is the SAME rule the client uses.
// A trade shown under one portfolio on screen and counted under another by the
// nightly pipeline is a disagreement nothing would surface — the numbers would
// simply be wrong, consistently, in a way that looks like a real result.

import { describe, expect, it } from 'vitest';
import { accountFilter, accountKey, type AccountScope } from '../../app/lib/portfolio/server';
import { adoptingPortfolioId } from '../../app/lib/portfolio/scope';
import type { Portfolio } from '../../app/lib/portfolio/types';

const pf = (id: string, createdAt: number): Portfolio => ({
  id, name: id, source: 'tradingview', timezone: 'Asia/Jerusalem',
  startingBalanceUsd: 1, createdAt,
});

describe('accountKey — what gets written', () => {
  it('is never null, because the AI tables key on it', () => {
    expect(accountKey({ accountId: 'pf_a', adoptsUnassigned: false })).toBe('pf_a');
    expect(accountKey({ accountId: null, adoptsUnassigned: true })).toBe('');
  });
});

describe('accountFilter — what gets read', () => {
  it('is null for a trader with no portfolios, so the journal reads whole', () => {
    expect(accountFilter({ accountId: null, adoptsUnassigned: true })).toBeNull();
  });

  it('reads one portfolio\'s rows and nothing else', () => {
    const f = accountFilter({ accountId: 'pf_b', adoptsUnassigned: false });
    expect(f).toBe('account_id.eq.pf_b');
  });

  it('lets the adopting portfolio pick up rows with no account', () => {
    // Both spellings of "unassigned": null on a journal_trades row that
    // predates the column, and the empty string the mirror writes.
    const f = accountFilter({ accountId: 'pf_a', adoptsUnassigned: true })!;
    expect(f).toContain('account_id.eq.pf_a');
    expect(f).toContain('account_id.is.null');
    expect(f).toContain('account_id.eq.');
  });

  it('never lets a second portfolio adopt the same rows', () => {
    // Otherwise an unassigned trade would be counted twice across the account.
    const a = accountFilter({ accountId: 'pf_a', adoptsUnassigned: true })!;
    const b = accountFilter({ accountId: 'pf_b', adoptsUnassigned: false })!;
    expect(a.includes('is.null')).toBe(true);
    expect(b.includes('is.null')).toBe(false);
  });
});

describe('one rule, two callers', () => {
  it('the server adopts through the same pure function the client uses', () => {
    // Not a re-implementation. Two implementations of this rule would
    // disagree eventually, and the disagreement would be invisible.
    const src = readSource('app/lib/portfolio/server.ts');
    expect(src).toContain("from './scope'");
    expect(src).toContain('adoptingPortfolioId(portfolios)');
  });

  it('and that function is the oldest-first one', () => {
    expect(adoptingPortfolioId([pf('b', 2), pf('a', 1)])).toBe('a');
  });
});

describe('an id the caller sent', () => {
  it('is checked against the trader\'s own portfolios', () => {
    // A forged id can only reach rows the caller already owns — every query is
    // clerk-scoped underneath — but it would let one portfolio's analysis be
    // written under another's key, corrupting their own record.
    const src = readSource('app/lib/portfolio/server.ts');
    expect(src).toContain('portfolios.some(p => p.id === requested)');
  });
});

describe('every AI table now keys on the account', () => {
  const repo = readSource('app/lib/intelligence/repository.ts');
  for (const conflict of [
    "onConflict: 'clerk_id,account_id'",
    "onConflict: 'clerk_id,account_id,pattern_id'",
    "onConflict: 'clerk_id,account_id,iso_week'",
  ]) {
    it(`writes with ${conflict}`, () => expect(repo).toContain(conflict));
  }

  it('reads the profile, patterns, hypothesis and reports through it', () => {
    expect(repo.match(/\.eq\('account_id', accountKey\(scope\)\)/g)?.length).toBeGreaterThanOrEqual(5);
  });
});

function readSource(p: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('fs') as typeof import('fs')).readFileSync(p, 'utf8');
}

describe('the night', () => {
  const sched = readSource('app/lib/coach-pipeline/pipelines/scheduleNightlyJobs.ts');
  const batch = readSource('app/lib/coach-pipeline/pipelines/processJobBatch.ts');
  const provider = readSource('app/components/PortfolioProvider.tsx');

  it('picks one portfolio per trader, not one job per portfolio', () => {
    // A daily insight costs a model call. One per portfolio per night
    // multiplies that by however many accounts a trader keeps, forever.
    expect(sched).toContain('nightlyScopeFor(');
    expect(sched).toContain('if (!scope) { idleSkipped += 1; continue; }');
  });

  it('counts the traders it skipped rather than letting them vanish', () => {
    // A night where this number jumps is a signal; without it the drop in
    // enqueued jobs would read as users disappearing.
    expect(sched).toContain('idleSkipped');
  });

  it('carries the portfolio on the job instead of re-deriving it later', () => {
    // Re-deriving hours later could land on a different account if the trader
    // switched in between, and the note would be about something they never
    // asked about.
    expect(sched).toContain('accountId:   scope.accountId');
    expect(batch).toContain('accountId: job.account_id');
    expect(batch).toContain("refreshIntelligenceNightly(job.clerk_id, job.account_id ?? '')");
  });

  it('can see which portfolio is active, which a server otherwise cannot', () => {
    // The selection itself never leaves the browser. This is a different
    // fact — when the account was last looked at, by anyone, on anything.
    expect(provider).toContain('lastActiveAt: Date.now()');
  });
});
