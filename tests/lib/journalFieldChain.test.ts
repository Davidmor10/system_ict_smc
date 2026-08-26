// ─────────────────────────────────────────────────────────────────────────────
// The field chain: form → validation → journal_trades row → back again.
//
// This file exists because of a bug that produced no error anywhere. The form
// collected "עמדתי בחוקים", the request carried it, and tradeEntrySchema — a
// z.object(), which strips undeclared keys by default — deleted it before any
// consumer ran. Everything downstream saw `undefined`, wrote null, and reported
// "0 usable trades" as though the trader had simply never answered.
//
// A silent strip cannot be caught by types (the parsed value is typed from the
// schema, so the schema is always "right") and it cannot be caught by the
// happy-path tests (nothing throws). It can only be caught by asserting that a
// field survives the round trip. So: every field the behaviour layer cannot
// work without gets an assertion here, and a new one gets a line the day it is
// added.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { tradeEntrySchema } from '../../app/lib/validation';
import { rowToTrade, tradeToRow, type TradeRow } from '../../app/api/journal/route';
import { tradeEntryToIntelligenceRow } from '../../app/lib/coach-pipeline/mirror/journalToIntelligence';
import { migrateTrade, type TradeEntry } from '../../app/lib/journal';

const base = {
  id: 1_700_000_000_000,
  dateISO: '2026-08-12',
  time: '16:35',
  symbol: 'ES' as const,
  contracts: 2,
  direction: 'LONG' as const,
  entry: 5000,
  stop: 4990,
  target: 5030,
  session: 'NYAM',
  bias: 'BULLISH' as const,
  model: 'Silver Bullet',
  result: 'WIN' as const,
  notes: '',
};

describe('tradeEntrySchema — fields the detectors depend on', () => {
  it('keeps followedRules=false (the answer that makes the detector fire)', () => {
    const parsed = tradeEntrySchema.parse({ ...base, followedRules: false });
    expect(parsed.followedRules).toBe(false);
  });

  it('keeps followedRules=true', () => {
    expect(tradeEntrySchema.parse({ ...base, followedRules: true }).followedRules).toBe(true);
  });

  it('leaves followedRules undefined when unanswered — never defaults it to true', () => {
    expect(tradeEntrySchema.parse({ ...base }).followedRules).toBeUndefined();
  });

  it('keeps the exit legs, which are the only record of where the trade closed', () => {
    const parsed = tradeEntrySchema.parse({
      ...base,
      exits: [{ price: 5015, contracts: 1 }, { price: 5025, contracts: 1 }],
    });
    expect(parsed.exits).toHaveLength(2);
    expect(parsed.exits?.[0]).toEqual({ price: 5015, contracts: 1 });
  });
});

describe('journal_trades row mapping', () => {
  const trade = { ...base, followedRules: false, exits: [{ price: 5015, contracts: 2 }] } as TradeEntry;

  it('writes followed_rules and exits to the row', () => {
    const row = tradeToRow('user_1', trade);
    expect(row.followed_rules).toBe(false);
    expect(row.exits).toEqual([{ price: 5015, contracts: 2 }]);
  });

  it('writes null — not false — when the trader did not answer', () => {
    const row = tradeToRow('user_1', { ...base } as TradeEntry);
    expect(row.followed_rules).toBeNull();
  });

  it('round-trips through the row and back without losing the verdict', () => {
    const back = rowToTrade(tradeToRow('user_1', trade) as TradeRow);
    expect(back.followedRules).toBe(false);
    expect(back.exits).toEqual([{ price: 5015, contracts: 2 }]);
  });

  it('reads an unanswered row back as undefined, so a merge cannot invent a verdict', () => {
    const back = rowToTrade(tradeToRow('user_1', { ...base } as TradeEntry) as TradeRow);
    expect(back.followedRules).toBeUndefined();
  });
});

describe('the whole chain, validation → mirror', () => {
  it('carries a rule violation and a real exit price into intelligence_trades', () => {
    const parsed = tradeEntrySchema.parse({
      ...base,
      followedRules: false,
      exits: [{ price: 5010, contracts: 1 }, { price: 5020, contracts: 1 }],
    });
    const mirrored = tradeEntryToIntelligenceRow('user_1', parsed as TradeEntry);

    expect(mirrored.followed_rules).toBe(false);
    // Contract-weighted average of the two legs — the measured exit, not the target.
    expect(mirrored.exit_price).toBe(5015);
    expect(mirrored.take_profit).toBe(5030);
  });

  it('carries "unanswered" as null all the way down', () => {
    const parsed = tradeEntrySchema.parse({ ...base });
    expect(tradeEntryToIntelligenceRow('user_1', parsed as TradeEntry).followed_rules).toBeNull();
    expect(tradeEntryToIntelligenceRow('user_1', parsed as TradeEntry).exit_price).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The setup field, and an answer nobody gave.
//
// `migrateTrade` defaulted a missing setup to 'REVERSAL'. That is not a
// backward-compatibility repair — nothing in the form has ever asked this
// question, so the fallback applied to every trade ever loaded from local
// storage. And `loadTrades` pushes what it parses to the cloud, so the
// invented value reached intelligence_trades and from there the coach's facts
// block, where `bySetup` built a bucket the model was told about by name.
//
// The cloud path never did this — rowToTrade has always left it undefined — so
// the same trade meant different things depending on which side it was loaded
// from, which is the shape of every other defect found in this pass.
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTrade and the setup field', () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    id: 1_700_000_000_001,
    dateISO: '2026-08-10', time: '17:00', symbol: 'MNQ', direction: 'LONG',
    entry: 20000, stop: 19980, target: 20060, result: 'WIN',
    session: 'ny_am', bias: 'BULLISH', model: '', notes: '',
    ...over,
  });

  it('leaves setup undefined when the trade never carried one', () => {
    // THE REGRESSION. Every trade came back marked REVERSAL.
    expect(migrateTrade(raw())?.setup).toBeUndefined();
  });

  it('keeps a setup the trade actually carried', () => {
    expect(migrateTrade(raw({ setup: 'CONTINUATION' }))?.setup).toBe('CONTINUATION');
    expect(migrateTrade(raw({ setup: 'REVERSAL' }))?.setup).toBe('REVERSAL');
  });

  it('drops a value that is not one of the two', () => {
    expect(migrateTrade(raw({ setup: 'SOMETHING' }))?.setup).toBeUndefined();
    expect(migrateTrade(raw({ setup: null }))?.setup).toBeUndefined();
  });

  it('agrees with the cloud path on a trade with no setup', () => {
    // The invariant that was broken: one trade, two loaders, one answer.
    const local = migrateTrade(raw())?.setup;
    const cloud = rowToTrade({
      id: 1_700_000_000_001, clerk_id: 'u', date_iso: '2026-08-10', time_val: '17:00',
      symbol: 'MNQ', contracts: 1, direction: 'LONG', entry: 20000, stop_price: 19980,
      target: 20060, session: 'ny_am', bias: 'BULLISH', model: '', result: 'WIN',
      notes: '', account_id: null, setup: null, bias_alignment: null, trade_r: 2,
      pnl_usd: 200, screenshots: null, exits: null, confirmations: null,
      emotional_state: null, followed_rules: null, stop_moved: null, stop_note: null,
      management: null, deleted_at: null, updated_at: null,
    }).setup;
    expect(local).toBe(cloud);
  });
});
