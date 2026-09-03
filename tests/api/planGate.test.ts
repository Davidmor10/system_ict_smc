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
const journey = await import('../../app/api/coach/journey/route');

const body = (o: unknown) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(o) });

beforeEach(() => { role = 'free'; });

describe('an account with no subscription is refused', () => {
  const cases: Array<[string, () => Promise<Response>, string]> = [
    ['GET  /api/journal',         () => journal.GET(), 'starter'],
    ['POST /api/journal',         () => journal.POST(body({})), 'starter'],
    ['PUT  /api/journal',         () => journal.PUT(body([])), 'starter'],
    ['DELETE /api/journal/[id]',  () => journalItem.DELETE(new Request('http://x'), { params: Promise.resolve({ id: '1' }) }), 'starter'],
    ['PATCH  /api/journal/[id]',  () => journalItem.PATCH(body({}), { params: Promise.resolve({ id: '1' }) }), 'starter'],
    ['GET  /api/collections',     () => collections.GET(new Request('http://x/api/collections?kind=k')), 'starter'],
    ['PUT  /api/collections',     () => collections.PUT(body({})), 'starter'],
    ['GET  /api/preferences',     () => preferences.GET(), 'starter'],
    ['PUT  /api/preferences',     () => preferences.PUT(body({})), 'starter'],
    ['GET  /api/macro',           () => macro.GET(new NextRequest('http://x/api/macro')), 'starter'],
    // Analysis starts at pro — starter buys the journal, not the AI.
    ['GET  /api/coach/readiness', () => readiness.GET(), 'pro'],
    ['GET  /api/coach/daily-insight', () => dailyInsight.GET(), 'pro'],
    // The journey screen carries the behaviour lifecycle and the score
    // history, both produced by the pipeline that starts at pro.
    ['GET  /api/coach/journey',   () => journey.GET(), 'pro'],
  ];

  for (const [name, call, requiredPlan] of cases) {
    it(`${name} answers 403, not data`, async () => {
      const res = await call();
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.requiredPlan).toBe(requiredPlan);
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

// ── analysis starts at pro ──────────────────────────────────────────────────
//
// Starter buys the journal: the log, the notebook, the setups, the rules and
// the statistics over what was written. It does not buy the AI, and the way
// this is sold is not "compute it and hide it" — a starter account's trades
// are never analysed at all, and the night the trader upgrades is the night
// the system starts watching.

describe('a starter account is refused the analysis', () => {
  it('gets 403 from the AI routes it did not pay for', async () => {
    role = 'starter';
    for (const call of [() => readiness.GET(), () => dailyInsight.GET(), () => journey.GET()]) {
      const res = await call();
      expect(res.status).toBe(403);
      expect((await res.json()).requiredPlan).toBe('pro');
    }
  });

  it('keeps everything the journal tier does include', async () => {
    role = 'starter';
    for (const call of [
      () => journal.GET(),
      () => collections.GET(new Request('http://x/api/collections?kind=k')),
      () => macro.GET(new NextRequest('http://x/api/macro')),
    ]) {
      expect((await call()).status).not.toBe(403);
    }
  });

  it('lets pro through the same AI routes', async () => {
    role = 'pro';
    for (const call of [() => readiness.GET(), () => dailyInsight.GET(), () => journey.GET()]) {
      expect((await call()).status).not.toBe(403);
    }
  });
});

// ── the setting that decides where money goes ───────────────────────────────
//
// The Bit number is not a secret — every customer sees it — but whoever can
// WRITE it decides where the payments land. So it carries the admin gate, not
// the plan gate, and a signed-in subscriber must not get past it.

describe('the payment settings route is admin-only', () => {
  it('refuses a signed-in non-admin on both verbs', async () => {
    role = 'deluxe';
    const settings = await import('../../app/api/payment-settings/route');
    for (const call of [
      () => settings.GET(),
      () => settings.PUT(new Request('http://x', { method: 'PUT', body: '{"number":"050","payee":"x"}' })),
    ]) {
      const res = await call();
      expect(res.status).toBe(403);
    }
  });
});
