// ─────────────────────────────────────────────────────────────────────────────
// Pure merge logic for cross-device sync. localStorage is a cache; Supabase is
// the source of truth. On load we fetch the cloud copy and merge it with the
// local copy — newest edit wins (by updatedAt), deduped by id, keeping deletes
// as tombstones so a delete on one device propagates to the others. No I/O here
// so it's fully unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface Syncable {
  id: string | number;
  /** epoch ms of the last edit; missing is treated as oldest. */
  updatedAt?: number;
  /** soft-delete tombstone — kept through merges so deletes propagate. */
  deleted?: boolean;
}

/** Merge two lists of the same entity by id. The record with the newer
    updatedAt wins; local wins exact ties (it's the more recent session). The
    result is the union of both sides, deduped by id, tombstones included. */
export function mergeById<T extends Syncable>(local: T[], cloud: T[]): T[] {
  const map = new Map<string, T>();
  const put = (it: T) => {
    const key = String(it.id);
    const cur = map.get(key);
    if (!cur || (it.updatedAt ?? 0) >= (cur.updatedAt ?? 0)) map.set(key, it);
  };
  // Cloud first, then local, so a local record with an equal-or-newer stamp wins.
  cloud.forEach(put);
  local.forEach(put);
  return [...map.values()];
}

/** The visible (non-tombstoned) subset — what the UI should render. */
export function active<T extends Syncable>(items: T[]): T[] {
  return items.filter(i => !i.deleted);
}

/** True when there's anything only on one side, or any id whose two copies
    differ in updatedAt — i.e. the merged result should be pushed back up. */
export function needsPush<T extends Syncable>(merged: T[], cloud: T[]): boolean {
  if (merged.length !== cloud.length) return true;
  const byId = new Map(cloud.map(c => [String(c.id), c.updatedAt ?? 0]));
  return merged.some(m => byId.get(String(m.id)) !== (m.updatedAt ?? 0));
}

/** Single-object docs (preferences, lockout, a day's plan): newer wins. */
export function newerDoc<T extends { updatedAt?: number }>(local: T | null, cloud: T | null): T | null {
  if (!local) return cloud;
  if (!cloud) return local;
  return (local.updatedAt ?? 0) >= (cloud.updatedAt ?? 0) ? local : cloud;
}
