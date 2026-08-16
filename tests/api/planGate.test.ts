// ─────────────────────────────────────────────────────────────────────────────
// The paid-plan gate, on the routes that carry the data.
//
// Onyx has no free tier. Blocking the dashboard in the UI is not enough on its
// own — the pages call these routes, and anything a page can call, a signed-in
// account with no subscription can call directly. This suite is the proof that
// they cannot.
//
// It is deliberately the mirror image of the other API suites: those mock the
// role to a subscriber so they can test isolation, this one mocks it to `free`
// so it can test the gate. Without it, the mock added to those files would
// have quietly disabled the very thing it was added because of.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let role = 'free';

vi.mock('../../app/lib/getUserRole', () => ({
  getUserRole: vi.fn(async () => role),
  ROLE_RANK: { free: 0, starter: 1, pro: 2, deluxe: 3 },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: 'user_1' })),
  currentUser: vi.fn(async () => ({ id: 'user_1' })),
}));

vi.mock('../../app/lib/supabase/server', () => ({
  isSupabaseConfigured: () => false,
  createServerSupabaseClient: () => null,
}));

vi.mock('../../app/lib/ai/macroCalendar', () => ({
  getMacroEvents: vi.fn(async () => []),
  israelToday: () => '2026-07-15',
}));

const journal = await import('../../app/api/journal/route');
const journalItem = await import('../../app/api/journal/[id]/route');
const collections = await import('../../app/api/collections/route');
const preferences = await import('../../app/api/preferences/route');
const macro = await import('../../app/api/macro/route');
const readiness = await import('../../app/api/coach/readiness/route');
const dailyInsight = await import('../../app/api/coach/daily-insight/route');

const body = (o: unknown) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(o) });

beforeEach(() => { role = 'free'; });

describe('an account with no subscription is refused', () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ['GET  /api/journal',         () => journal.GET()],
    ['POST /api/journal',         () => journal.POST(body({}))],
    ['PUT  /api/journal',         () => journal.PUT(body([]))],
    ['DELETE /api/journal/[id]',  () => journalItem.DELETE(new Request('http://x'), { params: Promise.resolve({ id: '1' }) })],
    ['PATCH  /api/journal/[id]',  () => journalItem.PATCH(body({}), { params: Promise.resolve({ id: '1' }) })],
    ['GET  /api/collections',     () => collections.GET(new Request('http://x/api/collections?kind=k'))],
    ['PUT  /api/collections',     () => collections.PUT(body({}))],
    ['GET  /api/preferences',     () => preferences.GET()],
    ['PUT  /api/preferences',     () => preferences.PUT(body({}))],
    ['GET  /api/macro',           () => macro.GET(new NextRequest('http://x/api/macro'))],
    ['GET  /api/coach/readiness', () => readiness.GET()],
    ['GET  /api/coach/daily-insight', () => dailyInsight.GET()],
  ];

  for (const [name, call] of cases) {
    it(`${name} answers 403, not data`, async () => {
      const res = await call();
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.requiredPlan).toBe('starter');
    });
  }
});

describe('a subscriber is let through the same gate', () => {
  // Proves the 403s above come from the plan check and not from some unrelated
  // failure that would have rejected every caller equally.
  it('stops returning 403 the moment the role is a paid one', async () => {
    role = 'starter';
    for (const call of [
      () => journal.GET(),
      () => preferences.GET(),
      () => macro.GET(new NextRequest('http://x/api/macro')),
    ]) {
      expect((await call()).status).not.toBe(403);
    }
  });
});
