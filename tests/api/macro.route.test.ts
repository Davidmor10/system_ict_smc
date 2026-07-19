// ─────────────────────────────────────────────────────────────────────────────
// /api/macro — defaults to today's events, but ?scope=week widens the filter
// to the rest of the current week. The underlying feed is already a weekly
// pull (see macroCalendar.test.ts / getMacroEvents), so this route only needs
// to prove it filters correctly, not that it fetches correctly.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let currentUserId: string | null = 'user_1';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: currentUserId })),
}));

vi.mock('../../app/lib/supabase/server', () => ({
  isSupabaseConfigured: () => false,
  createServerSupabaseClient: () => null,
}));

const TODAY = '2026-07-15';
const events = [
  { title: 'Past Event',    currency: 'USD', impact: 'High' as const, dateIsrael: '2026-07-13', timeIsrael: '10:00' },
  { title: 'CPI m/m',       currency: 'USD', impact: 'High' as const, dateIsrael: TODAY,          timeIsrael: '15:30' },
  { title: 'FOMC Minutes',  currency: 'USD', impact: 'High' as const, dateIsrael: '2026-07-17',    timeIsrael: '21:00' },
];

vi.mock('../../app/lib/ai/macroCalendar', () => ({
  getMacroEvents: vi.fn(async () => events),
  israelToday: () => TODAY,
}));

const { GET } = await import('../../app/api/macro/route');

function req(url: string) {
  return new NextRequest(url);
}

beforeEach(() => { currentUserId = 'user_1'; });

describe('GET /api/macro', () => {
  it('defaults to today only', async () => {
    const res = await GET(req('http://x/api/macro'));
    const body = await res.json();
    expect(body.today).toBe(TODAY);
    expect(body.scope).toBe('today');
    expect(body.events.map((e: { title: string }) => e.title)).toEqual(['CPI m/m']);
  });

  it('?scope=week includes today and the rest of the week, excludes past days', async () => {
    const res = await GET(req('http://x/api/macro?scope=week'));
    const body = await res.json();
    expect(body.scope).toBe('week');
    const titles = body.events.map((e: { title: string }) => e.title);
    expect(titles).toEqual(['CPI m/m', 'FOMC Minutes']);
    expect(titles).not.toContain('Past Event');
  });

  it('an unrecognized scope value falls back to today', async () => {
    const res = await GET(req('http://x/api/macro?scope=bogus'));
    expect((await res.json()).scope).toBe('today');
  });

  it('401s with no session', async () => {
    currentUserId = null;
    const res = await GET(req('http://x/api/macro?scope=week'));
    expect(res.status).toBe(401);
  });
});
