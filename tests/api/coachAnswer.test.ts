// ─────────────────────────────────────────────────────────────────────────────
// POST /api/coach/daily-insight/answer
//
// This route carries the only evidence in the system that isn't derived from
// the trade history, which makes both of its failure modes expensive:
// rejecting a real answer loses something the trader took a minute to write,
// and accepting a malformed one attaches it to the wrong behaviour — or to no
// behaviour, silently.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUserId: string | null = 'user_1';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: currentUserId })),
}));

const recordAnswer = vi.fn(async () => true);
vi.mock('../../app/lib/coach-pipeline/db/behaviorFindings', () => ({
  recordAnswer: (...args: unknown[]) => recordAnswer(...(args as [])),
}));

const { POST } = await import('../../app/api/coach/daily-insight/answer/route');

function post(body: unknown) {
  return POST(new Request('http://x/api/coach/daily-insight/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  currentUserId = 'user_1';
  recordAnswer.mockClear();
  recordAnswer.mockResolvedValue(true);
});

describe('auth', () => {
  it('rejects an anonymous caller', async () => {
    currentUserId = null;
    expect((await post({ kind: 'rule_violation', answer: 'x' })).status).toBe(401);
    expect(recordAnswer).not.toHaveBeenCalled();
  });
});

describe('validation', () => {
  it('rejects an unknown behaviour kind', async () => {
    const res = await post({ kind: 'made_up_behaviour', answer: 'הייתי לחוץ' });
    expect(res.status).toBe(400);
    expect(recordAnswer).not.toHaveBeenCalled();
  });

  // Object.prototype keys are the classic way an `in` check says yes to a
  // string that was never a valid value.
  it('rejects a prototype key posing as a kind', async () => {
    expect((await post({ kind: 'constructor', answer: 'x' })).status).toBe(400);
    expect((await post({ kind: 'toString',    answer: 'x' })).status).toBe(400);
  });

  it('rejects an empty or whitespace-only answer', async () => {
    expect((await post({ kind: 'rule_violation', answer: '' })).status).toBe(400);
    expect((await post({ kind: 'rule_violation', answer: '   ' })).status).toBe(400);
  });

  it('rejects an answer past the length bound instead of storing a fragment', async () => {
    const res = await post({ kind: 'rule_violation', answer: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(recordAnswer).not.toHaveBeenCalled();
  });

  it('rejects a malformed body', async () => {
    const res = await POST(new Request('http://x/api/coach/daily-insight/answer', {
      method: 'POST', body: 'not json',
    }));
    expect(res.status).toBe(400);
  });
});

describe('the happy path', () => {
  it('stores the answer against the caller and the named behaviour', async () => {
    const res = await post({ kind: 'discretionary_exit', answer: 'יצאתי כי פחדתי לאבד את הרווח' });
    expect(res.status).toBe(200);
    expect(recordAnswer).toHaveBeenCalledWith('user_1', 'discretionary_exit', 'יצאתי כי פחדתי לאבד את הרווח');
  });

  // A write that matched no row is not a success. Silently returning ok would
  // show the trader "saved" for an answer that went nowhere.
  it('reports 404 when the trader has no finding of that kind', async () => {
    recordAnswer.mockResolvedValue(false);
    expect((await post({ kind: 'size_spike', answer: 'x' })).status).toBe(404);
  });
});
