// ─────────────────────────────────────────────────────────────────────────────
// generateWorkingStrengths — "מה באמת עובד לך" (AI-analytics flagship section).
// Verifies the new filtering/mapping logic on top of the already-tested
// pattern_memory lifecycle: only genuine above-baseline patterns surface, a
// low-confidence one gets the fixed disclaimer instead of an AI claim, and
// nothing ever leaks across users.
// ─────────────────────────────────────────────────────────────────────────────

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
  generateHypothesisPhrasing: vi.fn(async () => ({ description: 'mock hypothesis', evidence: 'mock evidence' })),
  generatePatternPhrasing: vi.fn(async () => ({ title: 'mock title', evidence: 'mock evidence', action: 'mock action' })),
  generateWorkingStrengthsPhrasing: vi.fn(async (items: { subjectLabel: string }[]) =>
    items.map(it => `mock explanation for ${it.subjectLabel}`)),
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

/** 10 wins on ES/nyam + 10 losses on NQ/london: overall baseline sits at 50%,
    so the ES/nyam slice (100% winRate, n=10 — clears the medium-confidence
    floor) is unambiguously above baseline, while NQ/london is unambiguously
    below it. */
function mixedTrades(): TradeEntry[] {
  return [
    ...Array.from({ length: 10 }, () => makeTrade({ symbol: 'ES', session: 'nyam', result: 'WIN', entry: 100, stop: 99, target: 103 })),
    ...Array.from({ length: 10 }, () => makeTrade({ symbol: 'NQ', session: 'london', result: 'LOSS', entry: 100, stop: 99, target: 103 })),
  ];
}

/** Exactly 3 wins (the discoverPatterns floor) on a rare combo — clears the
    delta bar but stays at 'insufficient_data' (n=3 is well below the
    medium-confidence threshold of 10). */
function lowSampleWinner(): TradeEntry[] {
  return Array.from({ length: 3 }, () => makeTrade({ symbol: 'MNQ', session: 'asia', result: 'WIN', entry: 100, stop: 99, target: 103 }));
}

beforeEach(() => {
  fakeDb.tables = {};
  vi.clearAllMocks();
});

describe('generateWorkingStrengths', () => {
  it('surfaces the above-baseline pattern and excludes the below-baseline one', async () => {
    fakeDb.seed('journal_trades', mixedTrades().map(t => tradeRow('user_A', t)));

    const strengths = await service.generateWorkingStrengths('user_A');

    expect(strengths.some(s => JSON.stringify(s.name).includes('ES'))).toBe(true);
    expect(strengths.some(s => JSON.stringify(s.name).includes('NQ'))).toBe(false);
    const es = strengths.find(s => s.name.includes('ES'))!;
    expect(es.metric.winRate).toBe(100);
    expect(es.delta).toBeGreaterThan(0);
    expect(es.explanation).toContain('mock explanation');
    expect(es.isLowData).toBe(false);
  });

  it('gives a low-sample genuine edge the fixed disclaimer instead of an AI claim', async () => {
    fakeDb.seed('journal_trades', [...mixedTrades(), ...lowSampleWinner()].map(t => tradeRow('user_A', t)));

    const strengths = await service.generateWorkingStrengths('user_A');
    const mnq = strengths.find(s => s.name.includes('MNQ'));

    expect(mnq).toBeDefined();
    expect(mnq!.isLowData).toBe(true);
    expect(mnq!.explanation).toBe('עדיין אין מספיק נתונים כדי להסיק מסקנה אמינה.');
  });

  it('returns nothing when no pattern clears the discoverPatterns 3-trade floor', async () => {
    fakeDb.seed('journal_trades', []);
    expect(await service.generateWorkingStrengths('user_A')).toEqual([]);
  });

  it('never lets user B\'s strengths leak into user A\'s result', async () => {
    fakeDb.seed('journal_trades', [
      ...mixedTrades().map(t => tradeRow('user_A', t)),
      ...mixedTrades().map(t => ({ ...tradeRow('user_B', t), symbol: 'MNQ', session: 'asia' })),
    ]);

    const strengthsA = await service.generateWorkingStrengths('user_A');
    const strengthsB = await service.generateWorkingStrengths('user_B');

    expect(strengthsA.some(s => s.name.includes('MNQ'))).toBe(false);
    expect(strengthsB.some(s => s.name.includes('ES'))).toBe(false);
  });
});
