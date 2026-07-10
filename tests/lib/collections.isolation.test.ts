import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabaseClient } from '../helpers/fakeSupabase';

const fakeDb = new FakeSupabaseClient();
let currentUser: string | null = 'user_A';

vi.mock('../../app/lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  createServerSupabaseClient: () => fakeDb,
}));
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: currentUser }),
}));

const route = await import('../../app/api/collections/route');

const putReq = (kind: string, data: unknown) =>
  new Request('http://localhost/api/collections', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, data }),
  });
const getReq = (kind?: string) =>
  new Request(`http://localhost/api/collections${kind ? `?kind=${kind}` : ''}`);

beforeEach(() => { fakeDb.tables = {}; currentUser = 'user_A'; });

describe('/api/collections — cross-user isolation', () => {
  it('a user only ever reads their OWN collections', async () => {
    currentUser = 'user_A';
    await route.PUT(putReq('setups', [{ id: '1', name: 'A-setup' }]));
    currentUser = 'user_B';
    await route.PUT(putReq('setups', [{ id: '9', name: 'B-setup' }]));

    currentUser = 'user_A';
    const a = await (await route.GET(getReq())).json();
    expect(a.collections.setups).toEqual([{ id: '1', name: 'A-setup' }]);

    currentUser = 'user_B';
    const b = await (await route.GET(getReq('setups'))).json();
    expect(b.collections.setups).toEqual([{ id: '9', name: 'B-setup' }]);
  });

  it("one user's write never touches another user's same-kind row", async () => {
    currentUser = 'user_A'; await route.PUT(putReq('rules', [{ id: 'r1' }]));
    currentUser = 'user_B'; await route.PUT(putReq('rules', [{ id: 'r2' }]));
    currentUser = 'user_A'; await route.PUT(putReq('rules', [{ id: 'r1', text: 'edited' }]));

    const rows = fakeDb.getAll('user_collections');
    expect(rows.find(r => r.clerk_id === 'user_B')?.data).toEqual([{ id: 'r2' }]);
    expect(rows.find(r => r.clerk_id === 'user_A')?.data).toEqual([{ id: 'r1', text: 'edited' }]);
  });

  it('rejects an unauthenticated request', async () => {
    currentUser = null;
    expect((await route.GET(getReq())).status).toBe(401);
    expect((await route.PUT(putReq('setups', []))).status).toBe(401);
  });

  it('rejects an invalid kind', async () => {
    currentUser = 'user_A';
    expect((await route.PUT(putReq('BAD KIND !!', []))).status).toBe(400);
  });

  it('a fresh user with no rows reads an empty set, not someone else\'s', async () => {
    currentUser = 'user_A'; await route.PUT(putReq('setups', [{ id: '1', name: 'A' }]));
    currentUser = 'user_C';
    const c = await (await route.GET(getReq())).json();
    expect(c.collections).toEqual({});
  });
});
