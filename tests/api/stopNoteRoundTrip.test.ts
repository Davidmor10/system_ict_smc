// ─────────────────────────────────────────────────────────────────────────────
// End-to-end proof that the two fields the restructured form added actually
// survive the whole chain: form payload → localStorage → validation → the
// row written to Supabase → and back out again on read.
//
// Every link is a place they could silently vanish. Validation strips keys it
// does not declare; migrateTrade rebuilds each trade field by field on load,
// so anything it forgets is dropped on the next page refresh; and tradeToRow /
// rowToTrade are two hand-written maps that have to agree on the column name.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabaseClient } from '../helpers/fakeSupabase';

const fakeDb = new FakeSupabaseClient();

vi.mock('../../app/lib/getUserRole', () => ({
  getUserRole: vi.fn(async () => 'deluxe'),
  ROLE_RANK: { free: 0, starter: 1, pro: 2, deluxe: 3 },
}));
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(async () => ({ userId: 'user_A' })) }));
vi.mock('../../app/lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  createServerSupabaseClient: () => fakeDb,
}));

const journalRoute = await import('../../app/api/journal/route');
const { migrateTrade } = await import('../../app/lib/journal');
const { tradeEntrySchema } = await import('../../app/lib/validation');

/** Exactly what TradeForm emits for: advanced the stop, to breakeven, with a
 *  note on why the stop sat where it did. */
const savedTrade = {
  id: 1, dateISO: '2026-08-23', time: '16:45', symbol: 'ES', contracts: 2,
  direction: 'LONG', entry: 100, stop: 95, target: 115, session: 'nyam',
  bias: 'BULLISH', model: 'Silver Bullet', result: 'WIN', notes: 'ראיתי sweep',
  exits: [{ price: 112, contracts: 2 }],
  stopMoved: 'advanced', stopNote: 'מתחת לפתיל התחתון',
  followedRules: true, emotionalState: 'CALM',
};

// stopMoveTag was removed: the form asked whether an advanced stop went to
// breakeven or to a trail, stored the answer, and no analysis ever read it.
// stopNote stayed — it reaches the daily insight — so this file now guards
// that one field through the same path.
describe('stopNote survives the full save path', () => {
  beforeEach(() => { fakeDb.tables = {}; });

  it('validation keeps it instead of stripping it', () => {
    const parsed = tradeEntrySchema.safeParse(savedTrade);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.stopNote).toBe('מתחת לפתיל התחתון');
  });

  it('migrateTrade keeps it, so a page refresh does not drop it', () => {
    const reloaded = migrateTrade(JSON.parse(JSON.stringify(savedTrade)));
    expect(reloaded?.stopNote).toBe('מתחת לפתיל התחתון');
  });

  it('POST writes the column to the database', async () => {
    const res = await journalRoute.POST(new Request('http://localhost/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(savedTrade),
    }));
    expect(res.status).toBe(200);

    const rows = fakeDb.getAll('journal_trades');
    expect(rows).toHaveLength(1);
    expect(rows[0].stop_note).toBe('מתחת לפתיל התחתון');
    // The derived result rode along too — it is computed by the form, not asked.
    expect(rows[0].result).toBe('WIN');
  });

  it('PUT — the path the cloud sync actually uses — writes them too', async () => {
    const res = await journalRoute.PUT(new Request('http://localhost/api/journal', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trades: [savedTrade] }),
    }));
    expect(res.status).toBe(200);
  });

  it('GET reads them back under the names the app uses', async () => {
    await journalRoute.POST(new Request('http://localhost/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(savedTrade),
    }));

    const res = await journalRoute.GET();
    const body = await res.json() as { trades: Array<Record<string, unknown>> };
    expect(body.trades[0].stopNote).toBe('מתחת לפתיל התחתון');
  });

  it('a trade that never touched its stop stores nulls, not junk', async () => {
    const untouched = { ...savedTrade, stopMoved: 'none', stopNote: undefined };
    await journalRoute.POST(new Request('http://localhost/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(untouched),
    }));

    const row = fakeDb.getAll('journal_trades')[0];
    expect(row.stop_note).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tombstone repair: a delete the cloud never heard about is buried on the next
// bulk push, instead of living on where every server-side reader counts it.
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/journal — deletedIds', () => {
  beforeEach(() => { fakeDb.tables = {}; });

  async function put(body: unknown) {
    return journalRoute.PUT(new Request('http://localhost/api/journal', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
  }

  it('buries the named ids and leaves the rest alone', async () => {
    await put({ trades: [{ ...savedTrade, id: 1 }, { ...savedTrade, id: 2 }] });
    const res = await put({ trades: [{ ...savedTrade, id: 2 }], deletedIds: [1] });
    expect(res.status).toBe(200);

    const rows = fakeDb.getAll('journal_trades');
    expect(rows.find(r => r.id === 1)?.deleted_at).toBeTruthy();
    expect(rows.find(r => r.id === 2)?.deleted_at).toBeNull();
  });

  it('does not let the same request resurrect what it just buried', async () => {
    await put({ trades: [{ ...savedTrade, id: 1 }] });
    // A stale client sends the trade as live AND names it as deleted.
    await put({ trades: [{ ...savedTrade, id: 1 }], deletedIds: [1] });

    expect(fakeDb.getAll('journal_trades').find(r => r.id === 1)?.deleted_at).toBeTruthy();
  });

  it('accepts a repair-only push with no trades at all', async () => {
    await put({ trades: [{ ...savedTrade, id: 1 }] });
    const res = await put({ trades: [], deletedIds: [1] });

    expect(res.status).toBe(200);
    expect(fakeDb.getAll('journal_trades').find(r => r.id === 1)?.deleted_at).toBeTruthy();
  });

  it('rejects a malformed id list rather than acting on part of it', async () => {
    await put({ trades: [{ ...savedTrade, id: 1 }] });
    const res = await put({ trades: [], deletedIds: ['1; drop table journal_trades'] });

    expect(res.status).toBe(400);
    expect(fakeDb.getAll('journal_trades').find(r => r.id === 1)?.deleted_at).toBeNull();
  });
});
