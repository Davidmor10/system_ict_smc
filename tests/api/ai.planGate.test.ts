// ─────────────────────────────────────────────────────────────────────────────
// Plan enforcement on the AI APIs — the paid surfaces (coach, AI analytics,
// journal insights) must reject a direct fetch from an authenticated user on
// too low a plan with 403, not just hide the button in the UI. The page-layout
// requirePlan() guards don't protect the Route Handlers themselves; these
// tests pin the API-level gate.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabaseClient } from '../helpers/fakeSupabase';

const fakeDb = new FakeSupabaseClient();
let currentUserId: string | null = 'user_free';
let currentEmail = 'user@example.com';

// getUserContext() short-circuits to 'free' without this — the mocked auth()
// below is only consulted when a Clerk key appears to be configured.
process.env.CLERK_SECRET_KEY = 'test_key';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: currentUserId })),
  currentUser: vi.fn(async () => ({
    primaryEmailAddress: { emailAddress: currentEmail },
    emailAddresses: [{ emailAddress: currentEmail }],
  })),
}));

// connection() throws outside a real Next request scope; the gate only needs
// it as a prerender bailout, so it's a no-op here. Everything else (e.g.
// NextResponse) stays real.
vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('next/server')>();
  return { ...mod, connection: vi.fn(async () => {}) };
});

vi.mock('../../app/lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  createServerSupabaseClient: () => fakeDb,
}));

// Imported after the mocks above are registered, per Vitest's hoisting rules.
const chatRoute = await import('../../app/api/ai/chat/route');
const coachChatsRoute = await import('../../app/api/ai/coach/chats/route');
const coachChatByIdRoute = await import('../../app/api/ai/coach/chats/[id]/route');
const insightsRoute = await import('../../app/api/ai/insights/route');
const patternRoute = await import('../../app/api/ai/pattern-insights/route');
const weeklyRoute = await import('../../app/api/ai/weekly-report/route');
const strengthsRoute = await import('../../app/api/ai/strengths/route');

function post(body: unknown = { lang: 'he' }) {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
}

function seedProfiles() {
  fakeDb.seed('profiles', [
    { clerk_id: 'user_free', role: 'free' },
    { clerk_id: 'user_starter', role: 'starter' },
    { clerk_id: 'user_pro', role: 'pro' },
    { clerk_id: 'user_deluxe', role: 'deluxe' },
  ]);
}

beforeEach(() => {
  fakeDb.tables = {};
  seedProfiles();
  currentEmail = 'user@example.com';
});

describe('AI APIs — free plan is rejected with 403 on every paid surface', () => {
  beforeEach(() => { currentUserId = 'user_free'; });

  it('POST /api/ai/chat → 403', async () => {
    const res = await chatRoute.POST(post({ question: 'hi', lang: 'he' }) as never);
    expect(res.status).toBe(403);
    expect((await res.json()).requiredPlan).toBe('deluxe');
  });

  it('GET /api/ai/coach/chats → 403', async () => {
    const res = await coachChatsRoute.GET();
    expect(res.status).toBe(403);
  });

  it('GET + DELETE /api/ai/coach/chats/[id] → 403', async () => {
    const params = { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) };
    expect((await coachChatByIdRoute.GET(new Request('http://x'), params)).status).toBe(403);
    expect((await coachChatByIdRoute.DELETE(new Request('http://x'), params)).status).toBe(403);
  });

  it('POST /api/ai/insights → 403 (starter+ surface)', async () => {
    const res = await insightsRoute.POST(post() as never);
    expect(res.status).toBe(403);
    // AI Insight is the first paid step — gated at 'starter', not 'pro'.
    expect((await res.json()).requiredPlan).toBe('starter');
  });

  it('POST /api/ai/pattern-insights → 403', async () => {
    expect((await patternRoute.POST(post({ trades: [], lang: 'he' }) as never)).status).toBe(403);
  });

  it('POST /api/ai/weekly-report → 403', async () => {
    expect((await weeklyRoute.POST(post() as never)).status).toBe(403);
  });

  it('POST /api/ai/strengths → 403', async () => {
    const res = await strengthsRoute.POST(post() as never);
    expect(res.status).toBe(403);
    // Rendered on ai-analytics, which is now Pro+ (was Deluxe).
    expect((await res.json()).requiredPlan).toBe('pro');
  });

});

describe('AI APIs — a sufficient plan passes the gate', () => {
  it('deluxe user lists coach chats (200, empty list)', async () => {
    currentUserId = 'user_deluxe';
    const res = await coachChatsRoute.GET();
    expect(res.status).toBe(200);
    expect((await res.json()).chats).toEqual([]);
  });

  it('pro user is still below the deluxe coach surface (403)', async () => {
    currentUserId = 'user_pro';
    const res = await coachChatsRoute.GET();
    expect(res.status).toBe(403);
  });

  it('pro user passes the pro-level insights gate (not 403)', async () => {
    currentUserId = 'user_pro';
    const res = await insightsRoute.POST(post() as never);
    expect(res.status).not.toBe(403);
  });

  it('an owner email is granted deluxe regardless of the stored role', async () => {
    currentUserId = 'user_free';
    currentEmail = 'davidmor030908@gmail.com';
    const res = await coachChatsRoute.GET();
    expect(res.status).toBe(200);
  });

  it('deluxe user passes the strengths gate (not 403) with no trades yet', async () => {
    currentUserId = 'user_deluxe';
    const res = await strengthsRoute.POST(post() as never);
    expect(res.status).not.toBe(403);
    expect((await res.json()).strengths).toEqual([]);
  });

  it('starter user PASSES the insights gate (starter is the first paid step)', async () => {
    currentUserId = 'user_starter';
    const res = await insightsRoute.POST(post() as never);
    expect(res.status).not.toBe(403);
  });

  it('starter user is still BELOW the ai-analytics tier (strengths → 403)', async () => {
    currentUserId = 'user_starter';
    const res = await strengthsRoute.POST(post() as never);
    expect(res.status).toBe(403);
    expect((await res.json()).requiredPlan).toBe('pro');
  });

  it('pro user PASSES the strengths gate (it is a pro surface now, not deluxe)', async () => {
    // Under the four-tier model the AI Analytics page (and every API it
    // renders — strengths, patterns, weekly report) is Pro-tier, not
    // Deluxe. Only the Coach stays Deluxe-only.
    currentUserId = 'user_pro';
    expect((await strengthsRoute.POST(post() as never)).status).not.toBe(403);
  });


});

describe('AI APIs — unauthenticated requests still 401 before any plan logic', () => {
  it('every gated route returns 401 with no session', async () => {
    currentUserId = null;
    expect((await chatRoute.POST(post({ question: 'hi' }) as never)).status).toBe(401);
    expect((await coachChatsRoute.GET()).status).toBe(401);
    expect((await insightsRoute.POST(post() as never)).status).toBe(401);
    expect((await patternRoute.POST(post() as never)).status).toBe(401);
    expect((await weeklyRoute.POST(post() as never)).status).toBe(401);
    expect((await strengthsRoute.POST(post() as never)).status).toBe(401);
  });
});
