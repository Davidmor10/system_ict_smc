// ─────────────────────────────────────────────────────────────────────────────
// Minimal in-memory fake of the Supabase query-builder surface this app
// actually uses (.from/.select/.eq/.order/.update/.upsert/.maybeSingle, plus
// being directly awaitable). Enough to prove the app's OWN filtering logic
// (every route scoping by clerk_id) actually isolates users from each other —
// it does not exercise Postgres RLS itself, which only the real database can.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

export class FakeSupabaseClient {
  tables: Record<string, Row[]> = {};

  seed(table: string, rows: Row[]) {
    this.tables[table] = rows.map(r => ({ ...r }));
  }

  getAll(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = [];
    return new FakeQuery(this, table);
  }
}

type ResultShape = { data: Row[] | null; error: null };

class FakeQuery implements PromiseLike<ResultShape> {
  private filters: Array<[string, unknown]> = [];
  private mode: 'select' | 'update' | 'upsert' | 'insert' = 'select';
  private inFilters: [string, unknown[]][] = [];
  private updatePatch: Row | null = null;
  private upsertRows: Row[] | null = null;
  private upsertConflictCols: string[] = [];
  private insertRows: Row[] | null = null;
  private limitCount: number | null = null;

  constructor(private client: FakeSupabaseClient, private table: string) {}

  select(_cols?: string) { this.mode = 'select'; return this; }

  eq(col: string, val: unknown) { this.filters.push([col, val]); return this; }

  /** Only `is(col, null)` is exercised anywhere in this app — treated the
      same as an equality filter against `null`. */
  is(col: string, val: unknown) { this.filters.push([col, val]); return this; }

  /** `in(col, values)` — membership, the filter the tombstone-repair path uses
      to bury a batch of ids in one statement. */
  in(col: string, values: unknown[]) { this.inFilters.push([col, values]); return this; }

  order(_col: string, _opts?: unknown) { return this; }

  limit(n: number) { this.limitCount = n; return this; }

  update(patch: Row) { this.mode = 'update'; this.updatePatch = patch; return this; }

  insert(rows: Row | Row[]) {
    this.mode = 'insert';
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    this.mode = 'upsert';
    this.upsertRows = Array.isArray(rows) ? rows : [rows];
    this.upsertConflictCols = (opts?.onConflict ?? '').split(',').filter(Boolean);
    return this;
  }

  private matches(row: Row): boolean {
    // A `null` filter value (from `.is(col, null)`) matches both an explicit
    // null and a column the seed simply never set — mirrors real Postgres,
    // where an absent column reads back as NULL.
    const eqOk = this.filters.every(([col, val]) => (val === null ? (row[col] ?? null) === null : row[col] === val));
    return eqOk && this.inFilters.every(([col, vals]) => vals.includes(row[col]));
  }

  private runSelect(): ResultShape {
    const rows = this.client.getAll(this.table).filter(r => this.matches(r));
    return { data: this.limitCount !== null ? rows.slice(0, this.limitCount) : rows, error: null };
  }

  private runUpdate(): ResultShape {
    for (const row of this.client.getAll(this.table)) {
      if (this.matches(row)) Object.assign(row, this.updatePatch);
    }
    return { data: null, error: null };
  }

  private runInsert(): ResultShape {
    const all = this.client.getAll(this.table);
    for (const row of this.insertRows ?? []) all.push({ ...row });
    this.client.tables[this.table] = all;
    return { data: null, error: null };
  }

  private runUpsert(): ResultShape {
    const all = this.client.getAll(this.table);
    for (const incoming of this.upsertRows ?? []) {
      const existingIdx = all.findIndex(r => this.upsertConflictCols.every(c => r[c] === incoming[c]));
      if (existingIdx >= 0) Object.assign(all[existingIdx], incoming);
      else all.push({ ...incoming });
    }
    this.client.tables[this.table] = all;
    return { data: null, error: null };
  }

  private resolve(): ResultShape {
    if (this.mode === 'update') return this.runUpdate();
    if (this.mode === 'insert') return this.runInsert();
    if (this.mode === 'upsert') return this.runUpsert();
    return this.runSelect();
  }

  async maybeSingle() {
    const { data, error } = this.resolve();
    return { data: (data && data[0]) ?? null, error };
  }

  then<TResult1 = ResultShape, TResult2 = never>(
    onfulfilled?: ((value: ResultShape) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
}
