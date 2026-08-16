// ─────────────────────────────────────────────────────────────────────────────
// Cross-user isolation — the single most important guarantee in the app:
// user A must never be able to read, list, or modify user B's trades through
// the journal API, no matter what they put in the request body or URL.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabaseClient } from '../helpers/fakeSupabase';

const fakeDb = new FakeSupabaseClient();
let currentUserId: string | null = 'user_A';

// Every route now sits behind a paid-plan gate. These suites are about
// isolation and scope, not billing, so the caller is a subscriber here and the
// gate itself is covered by tests/api/planGate.test.ts.
vi.mock('../../app/lib/getUserRole', () => ({
  getUserRole: vi.fn(async () => 'deluxe'),
  ROLE_RANK: { free: 0, starter: 1, pro: 2, deluxe: 3 },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: currentUserId })),
}));

vi.mock('../../app/lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  createServerSupabaseClient: () => fakeDb,
}));

// Imported after the mocks above are registered, per Vitest's hoisting rules.
const journalRoute = await import('../../app/api/journal/route');
const journalIdRoute = await import('../../app/api/journal/[id]/route');

function userATrade(id: number) {
  return {
    id, dateISO: '2026-07-01', time: '10:00', symbol: 'ES', contracts: 1,
    direction: 'LONG', entry: 100, stop: 90, target: 130, session: 'london',
    bias: 'BULLISH', model: 'test', result: 'OPEN', notes: 'user A private note',
  };
}

beforeEach(() => {
  fakeDb.tables = {};
  currentUserId = 'user_A';
});

describe('journal API — cross-user isolation', () => {
  it('a fresh user sees no trades, including ones seeded for other users', async () => {
    fakeDb.seed('journal_trades', [
      { id: 1, clerk_id: 'user_A', date_iso: '2026-07-01', time_val: '10:00', symbol: 'ES', notes: 'A only' },
    ]);
    currentUserId = 'user_B';

    const res = await journalRoute.GET();
    const body = await res.json();
    expect(body.trades).toHaveLength(0);
  });

  it('user A cannot see user B\'s trades in GET, and vice versa', async () => {
    currentUserId = 'user_A';
    await journalRoute.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(userATrade(1)) }));

    currentUserId = 'user_B';
    await journalRoute.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ ...userATrade(1), notes: 'user B private note' }) }));

    currentUserId = 'user_A';
    const aRes = await journalRoute.GET();
    const aBody = await aRes.json();
    expect(aBody.trades).toHaveLength(1);
    expect(aBody.trades[0].notes).toBe('user A private note');

    currentUserId = 'user_B';
    const bRes = await journalRoute.GET();
    const bBody = await bRes.json();
    expect(bBody.trades).toHaveLength(1);
    expect(bBody.trades[0].notes).toBe('user B private note');
  });

  it('user B cannot delete or restore user A\'s trade by guessing its id', async () => {
    currentUserId = 'user_A';
    await journalRoute.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(userATrade(42)) }));

    currentUserId = 'user_B';
    await journalIdRoute.DELETE(new Request('http://x'), { params: Promise.resolve({ id: '42' }) });

    currentUserId = 'user_A';
    const res = await journalRoute.GET();
    const body = await res.json();
    // Still present and NOT soft-deleted — user B's delete request touched zero rows
    // because it was scoped to clerk_id = 'user_B', which owns nothing with id 42.
    expect(body.trades).toHaveLength(1);
    expect(body.trades[0].deletedAt).toBeNull();
  });

  it('user A deleting their own trade by id does soft-delete it', async () => {
    currentUserId = 'user_A';
    await journalRoute.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(userATrade(7)) }));
    await journalIdRoute.DELETE(new Request('http://x'), { params: Promise.resolve({ id: '7' }) });

    const res = await journalRoute.GET();
    const body = await res.json();
    expect(body.trades[0].deletedAt).not.toBeNull();
  });

  it('a bulk PUT from user A cannot be used to overwrite user B\'s trade with the same id', async () => {
    currentUserId = 'user_B';
    await journalRoute.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ ...userATrade(99), notes: 'B original' }) }));

    currentUserId = 'user_A';
    await journalRoute.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ trades: [{ ...userATrade(99), notes: 'A tried to overwrite' }] }) }));

    currentUserId = 'user_B';
    const res = await journalRoute.GET();
    const body = await res.json();
    // Upsert conflict key is (clerk_id, id) — a different clerk_id with the same
    // numeric id is a different row entirely, not an overwrite.
    expect(body.trades[0].notes).toBe('B original');
  });
});

describe('journal API — unauthenticated requests are rejected', () => {
  beforeEach(() => { currentUserId = null; });

  it('GET /api/journal returns 401 with no session', async () => {
    const res = await journalRoute.GET();
    expect(res.status).toBe(401);
  });

  it('POST /api/journal returns 401 with no session', async () => {
    const res = await journalRoute.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(userATrade(1)) }));
    expect(res.status).toBe(401);
  });

  it('DELETE /api/journal/[id] returns 401 with no session', async () => {
    const res = await journalIdRoute.DELETE(new Request('http://x'), { params: Promise.resolve({ id: '1' }) });
    expect(res.status).toBe(401);
  });
});
