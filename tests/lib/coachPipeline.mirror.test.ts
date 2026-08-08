import { describe, expect, it } from 'vitest';
import {
  deterministicUuid,
  tradeEntryToIntelligenceRow,
} from '../../app/lib/coach-pipeline/mirror/journalToIntelligence';
import type { TradeEntry } from '../../app/lib/journal';

function makeTrade(overrides: Partial<TradeEntry> = {}): TradeEntry {
  return {
    id:              123,
    dateISO:         '2026-08-15',
    time:            '10:00',
    symbol:          'ES',
    contracts:       2,
    direction:       'LONG',
    entry:           5000,
    stop:            4990,
    target:          5020,
    session:         'nyam',
    bias:            'BULLISH',
    model:           'SMT',
    result:          'WIN',
    notes:           'clean setup',
    tradeR:          1.5,
    pnlUsd:          750,
    ...overrides,
  } as TradeEntry;
}

describe('deterministicUuid', () => {
  it('returns a canonical uuid string (8-4-4-4-12)', () => {
    const u = deterministicUuid('user_abc', 42);
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('is stable — same inputs → same uuid', () => {
    expect(deterministicUuid('user_abc', 42)).toBe(deterministicUuid('user_abc', 42));
  });

  it('changes with clerk_id', () => {
    expect(deterministicUuid('user_a', 42)).not.toBe(deterministicUuid('user_b', 42));
  });

  it('changes with id', () => {
    expect(deterministicUuid('user_a', 1)).not.toBe(deterministicUuid('user_a', 2));
  });
});

describe('tradeEntryToIntelligenceRow', () => {
  const cid = 'user_test';

  it('maps every intelligence_trades field correctly', () => {
    const trade = makeTrade();
    const row = tradeEntryToIntelligenceRow(cid, trade);

    expect(row.clerk_id).toBe(cid);
    expect(row.id).toBe(deterministicUuid(cid, trade.id));
    expect(row.date).toBe('2026-08-15');
    expect(row.time).toBe('10:00');
    expect(row.symbol).toBe('ES');
    expect(row.direction).toBe('LONG');
    expect(row.contracts).toBe(2);
    expect(row.entry_price).toBe(5000);
    expect(row.stop_loss).toBe(4990);
    expect(row.take_profit).toBe(5020);
    expect(row.result).toBe('WIN');
    expect(row.session).toBe('nyam');
    expect(row.setup).toBeNull();     // legacy `model` maps NOT to setup; setup is its own field
    expect(row.r_multiple).toBe(1.5);
    expect(row.pnl_usd).toBe(750);
    expect(row.followed_rules).toBe(true);   // legacy has no field → default true
    expect(row.notes).toBe('clean setup');
    expect(row.tags).toEqual([]);
    expect(row.deleted_at).toBeNull();
  });

  it('defaults contracts to 1 when missing', () => {
    const trade = makeTrade({ contracts: undefined });
    expect(tradeEntryToIntelligenceRow(cid, trade).contracts).toBe(1);
  });

  it('nulls out optional fields cleanly', () => {
    const trade = makeTrade({
      time: '', session: '', bias: 'INDECISIVE',
      target: undefined, tradeR: undefined, pnlUsd: undefined,
      setup: undefined, confirmations: undefined, emotionalState: undefined,
      screenshots: undefined, exits: undefined,
    });
    const row = tradeEntryToIntelligenceRow(cid, trade);
    expect(row.time).toBeNull();
    expect(row.session).toBeNull();
    expect(row.take_profit).toBeNull();
    expect(row.r_multiple).toBeNull();
    expect(row.pnl_usd).toBeNull();
    expect(row.setup).toBeNull();
    expect(row.confirmations).toBeNull();
    expect(row.emotional_state).toBeNull();
    expect(row.exits).toBeNull();
    expect(row.screenshots).toBeNull();
  });

  it('sets deleted_at when deleted=true', () => {
    const row = tradeEntryToIntelligenceRow(cid, makeTrade(), true);
    expect(row.deleted_at).not.toBeNull();
    expect(new Date(row.deleted_at!).getTime()).toBeGreaterThan(0);
  });

  it('carries updated_at as a fresh ISO timestamp', () => {
    const row = tradeEntryToIntelligenceRow(cid, makeTrade());
    expect(row.updated_at).toBeDefined();
    const age = Date.now() - Date.parse(row.updated_at);
    expect(age).toBeLessThan(5000);
  });

  it('preserves confirmations array', () => {
    const trade = makeTrade({ confirmations: ['SMT', 'FVG'] });
    expect(tradeEntryToIntelligenceRow(cid, trade).confirmations).toEqual(['SMT', 'FVG']);
  });
});
