// ─────────────────────────────────────────────────────────────────────────────
// A database that has not run supabase-migration-stop-note.sql yet must not
// lose every trade save. PostgREST rejects the WHOLE upsert when one column in
// the payload is missing from its schema cache, so without the retry below a
// pending migration turns "save a trade" into a 500 for every trade, not just
// for the two new fields.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/lib/getUserRole', () => ({
  getUserRole: vi.fn(async () => 'deluxe'),
  ROLE_RANK: { free: 0, starter: 1, pro: 2, deluxe: 3 },
}));
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(async () => ({ userId: 'user_A' })) }));
vi.mock('../../app/lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  createServerSupabaseClient: () => { throw new Error('unused'); },
}));

const { upsertTrades } = await import('../../app/api/journal/route');

/** Records every payload it is handed, and fails the first attempt with the
 *  error PostgREST returns for a column it does not know about. */
function stubClient(errors: ({ code?: string; message: string } | null)[]) {
  const payloads: Record<string, unknown>[][] = [];
  let call = 0;
  const client = {
    from: () => ({
      upsert: async (rows: Record<string, unknown>[]) => {
        payloads.push(rows.map(r => ({ ...r })));
        return { error: errors[call++] ?? null };
      },
    }),
  };
  return { client, payloads };
}

const row = (id: number) => ({
  id, clerk_id: 'user_A', symbol: 'ES', stop_move_tag: 'breakeven', stop_note: 'מתחת לפתיל',
}) as never;

describe('upsertTrades — surviving a pending migration', () => {
  it('sends the new columns when the database has them', async () => {
    const { client, payloads } = stubClient([null]);
    const { error } = await upsertTrades(client as never, [row(1)]);

    expect(error).toBeNull();
    expect(payloads).toHaveLength(1);
    expect(payloads[0][0]).toHaveProperty('stop_move_tag', 'breakeven');
    expect(payloads[0][0]).toHaveProperty('stop_note', 'מתחת לפתיל');
  });

  it('retries without them when the column is missing, and the trade still saves', async () => {
    const { client, payloads } = stubClient([
      { code: 'PGRST204', message: "Could not find the 'stop_move_tag' column of 'journal_trades' in the schema cache" },
      null,
    ]);
    const { error } = await upsertTrades(client as never, [row(1), row(2)]);

    expect(error).toBeNull();
    expect(payloads).toHaveLength(2);
    // Every other column survives the retry — only the two new ones are dropped.
    expect(payloads[1][0]).not.toHaveProperty('stop_move_tag');
    expect(payloads[1][0]).not.toHaveProperty('stop_note');
    expect(payloads[1][0]).toHaveProperty('symbol', 'ES');
    expect(payloads[1]).toHaveLength(2);
  });

  it('does not retry, and does not swallow, an unrelated failure', async () => {
    const { client, payloads } = stubClient([{ code: '23505', message: 'duplicate key value' }]);
    const { error } = await upsertTrades(client as never, [row(1)]);

    expect(payloads).toHaveLength(1);
    expect(error?.message).toBe('duplicate key value');
  });
});
