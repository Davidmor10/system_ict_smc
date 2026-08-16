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

const prefsRoute = await import('../../app/api/preferences/route');

beforeEach(() => {
  fakeDb.tables = {};
  currentUserId = 'user_A';
});

describe('preferences API — cross-user isolation', () => {
  it('user A cannot read user B\'s preferences', async () => {
    fakeDb.seed('user_preferences', [
      { clerk_id: 'user_B', chart_tf_es: '15', chart_tf_nq: '15', analysis_state: null, lockout_config: null, news_filters: null },
    ]);

    currentUserId = 'user_A';
    const res = await prefsRoute.GET();
    const body = await res.json();
    expect(body.prefs).toBeNull();
  });

  it('user A writing preferences never touches user B\'s row', async () => {
    currentUserId = 'user_B';
    await prefsRoute.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ chart_tf_es: '15' }) }));

    currentUserId = 'user_A';
    await prefsRoute.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ chart_tf_es: '5' }) }));

    const bRow = fakeDb.getAll('user_preferences').find(r => r.clerk_id === 'user_B');
    expect(bRow?.chart_tf_es).toBe('15');

    currentUserId = 'user_A';
    const res = await prefsRoute.GET();
    const body = await res.json();
    expect(body.prefs.chart_tf_es).toBe('5');
  });

  it('rejects a malformed preferences body instead of writing it', async () => {
    const res = await prefsRoute.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ chart_tf_es: 12345 }) }));
    expect(res.status).toBe(400);
  });
});

describe('preferences API — unauthenticated requests are rejected', () => {
  beforeEach(() => { currentUserId = null; });

  it('GET /api/preferences returns 401 with no session', async () => {
    const res = await prefsRoute.GET();
    expect(res.status).toBe(401);
  });

  it('PUT /api/preferences returns 401 with no session', async () => {
    const res = await prefsRoute.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ chart_tf_es: '5' }) }));
    expect(res.status).toBe(401);
  });
});
