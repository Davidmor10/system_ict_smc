import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabaseClient } from '../helpers/fakeSupabase';
import { makeTrade } from '../helpers/trade';
import type { TradeEntry } from '../../app/lib/journal';

const fakeDb = new FakeSupabaseClient();

vi.mock('../../app/lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  createServerSupabaseClient: () => fakeDb,
}));

vi.mock('../../app/lib/ai/insightPhrasing', () => ({
  generateHypothesisPhrasing: vi.fn(async (input: { supportingMetrics: Record<string, unknown> }) => ({
    description: `Hypothesis about ${JSON.stringify(input.supportingMetrics)}`,
    evidence: 'mock hypothesis evidence',
  })),
  generatePatternPhrasing: vi.fn(async (row: { subject: Record<string, unknown>; patternId: string }) => ({
    title: `Pattern for ${JSON.stringify(row.subject)}`,
    evidence: `evidence for ${row.patternId}`,
    action: 'watch it',
  })),
}));

const service = await import('../../app/lib/intelligence/service');

function tradeRow(clerkId: string, t: TradeEntry) {
  return {
    id: t.id, clerk_id: clerkId, date_iso: t.dateISO, time_val: t.time, symbol: t.symbol, contracts: t.contracts,
    direction: t.direction, entry: t.entry, stop_price: t.stop, target: t.target, session: t.session, bias: t.bias,
    model: t.model, result: t.result, notes: t.notes, account_id: null, setup: null, confirmation: null,
    bias_alignment: null, trade_r: null, pnl_usd: null, screenshots: null, deleted_at: null,
  };
}

/** 12 wins on `symbol`/`session` — decided-trade count of 12 clears the
    medium-confidence threshold (>=10) used across the intelligence layer, so
    the resulting pattern actually qualifies as "active" instead of staying
    stuck at insufficient_data. */
function winningTrades(symbol: 'ES' | 'NQ' | 'MNQ', session: string): TradeEntry[] {
  return Array.from({ length: 12 }, () => makeTrade({ symbol, session, result: 'WIN', entry: 100, stop: 99, target: 103 }));
}

beforeEach(() => {
  fakeDb.tables = {};
});

describe('Trader Intelligence Service — cross-user isolation', () => {
  it('buildTraderProfile only ever writes the calling user\'s own trader_profiles row', async () => {
    const aTrades = winningTrades('ES', 'nyam');
    const bTrades = winningTrades('NQ', 'london');
    fakeDb.seed('journal_trades', [...aTrades.map(t => tradeRow('user_A', t)), ...bTrades.map(t => tradeRow('user_B', t))]);

    await service.buildTraderProfile('user_A');

    const rows = fakeDb.getAll('trader_profiles');
    expect(rows).toHaveLength(1);
    expect(rows[0].clerk_id).toBe('user_A');
    // @ts-expect-error jsonb payload typed loosely in the fake store
    expect(rows[0].profile.strongestInstrument.key).toBe('ES');
  });

  it('never lets user B\'s trades leak into user A\'s profile even when both exist in the same table', async () => {
    const aTrades = winningTrades('ES', 'nyam');
    const bTrades = winningTrades('NQ', 'london');
    fakeDb.seed('journal_trades', [...aTrades.map(t => tradeRow('user_A', t)), ...bTrades.map(t => tradeRow('user_B', t))]);

    await service.buildTraderProfile('user_A');
    await service.buildTraderProfile('user_B');

    const profiles = fakeDb.getAll('trader_profiles');
    expect(profiles).toHaveLength(2);
    const a = profiles.find(p => p.clerk_id === 'user_A');
    const b = profiles.find(p => p.clerk_id === 'user_B');
    // @ts-expect-error jsonb payload typed loosely in the fake store
    expect(a.profile.strongestInstrument.key).toBe('ES');
    // @ts-expect-error jsonb payload typed loosely in the fake store
    expect(b.profile.strongestInstrument.key).toBe('NQ');
  });

  it('updatePatternMemory scopes pattern_memory rows strictly by clerk_id', async () => {
    const aTrades = winningTrades('ES', 'nyam');
    const bTrades = winningTrades('NQ', 'london');
    fakeDb.seed('journal_trades', [...aTrades.map(t => tradeRow('user_A', t)), ...bTrades.map(t => tradeRow('user_B', t))]);

    await service.updatePatternMemory('user_A');
    await service.updatePatternMemory('user_B');

    const rows = fakeDb.getAll('pattern_memory');
    const aRows = rows.filter(r => r.clerk_id === 'user_A');
    const bRows = rows.filter(r => r.clerk_id === 'user_B');
    expect(aRows.length).toBeGreaterThan(0);
    expect(bRows.length).toBeGreaterThan(0);
    expect(aRows.some(r => JSON.stringify(r.subject).includes('NQ'))).toBe(false);
    expect(bRows.some(r => JSON.stringify(r.subject).includes('ES'))).toBe(false);
  });

  it('generateDashboardPrimaryInsight for user A never reflects user B\'s data', async () => {
    const aTrades = winningTrades('ES', 'nyam');
    const bTrades = winningTrades('NQ', 'london');
    fakeDb.seed('journal_trades', [...aTrades.map(t => tradeRow('user_A', t)), ...bTrades.map(t => tradeRow('user_B', t))]);

    const insightA = await service.generateDashboardPrimaryInsight('user_A');
    const insightB = await service.generateDashboardPrimaryInsight('user_B');

    expect(insightA?.title).toContain('ES');
    expect(insightA?.title).not.toContain('NQ');
    expect(insightB?.title).toContain('NQ');
    expect(insightB?.title).not.toContain('ES');
  });

  it('bootstraps trader_profiles/pattern_memory on a cold-start dashboard call, scoped to that user only', async () => {
    const aTrades = winningTrades('ES', 'nyam');
    fakeDb.seed('journal_trades', aTrades.map(t => tradeRow('user_A', t)));

    expect(fakeDb.getAll('trader_profiles')).toHaveLength(0);
    await service.generateDashboardPrimaryInsight('user_A');

    const profiles = fakeDb.getAll('trader_profiles');
    expect(profiles).toHaveLength(1);
    expect(profiles[0].clerk_id).toBe('user_A');
  });

  it('returns null with no trades and does not fabricate an insight', async () => {
    fakeDb.seed('journal_trades', []);
    expect(await service.generateDashboardPrimaryInsight('user_A')).toBeNull();
  });
});
