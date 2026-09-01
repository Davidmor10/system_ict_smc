// ─────────────────────────────────────────────────────────────────────────────
// Client sync for the generic user_collections store. localStorage is a cache;
// the cloud is the source of truth. hydrate* merges cloud into local on load;
// save* writes local immediately and pushes to the cloud, queueing the write as
// `pending` if the network fails so nothing is lost silently — the queue is
// flushed on the next save/hydrate and whenever the browser comes back online.
// ─────────────────────────────────────────────────────────────────────────────

import { mergeById, active, needsPush, newerDoc, type Syncable } from './merge';
import { owner, readOwned, writeOwned, stale } from './owned';
import { ownedFetch } from './ownedFetch';

const PENDING_KEY = 'onyx_sync_pending';

type Pending = Record<string, unknown>; // kind → last data (last-write-wins per kind)

// The queue holds writes that failed and will be retried. Owned like every
// other cache, and for a sharper reason than most: a write queued by one
// account and flushed after another has signed in would be sent up under the
// new session. That is this leak with a delay on it.
function readPending(): Pending {
  if (typeof window === 'undefined') return {};
  return readOwned<Pending>(PENDING_KEY) ?? {};
}
function writePending(p: Pending): void {
  writeOwned(PENDING_KEY, p);
}
function queue(kind: string, data: unknown): void {
  const p = readPending(); p[kind] = data; writePending(p);
}

async function put(kind: string, data: unknown): Promise<boolean> {
  try {
    const res = await ownedFetch('/api/collections', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, data }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Retries every queued write; drops the ones that now succeed. Best-effort. */
export async function flushPending(): Promise<void> {
  if (typeof window === 'undefined') return;
  const p = readPending();
  const kinds = Object.keys(p);
  if (kinds.length === 0) return;
  for (const kind of kinds) {
    if (await put(kind, p[kind])) { delete p[kind]; }
  }
  writePending(p);
}

/** Push a collection to the cloud; on failure, queue it for later. */
async function pushCollection(kind: string, data: unknown): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!(await put(kind, data))) queue(kind, data);
}

// Every local read and write goes through the owner envelope — see ./owned.
// A cache belonging to another account reads as empty, so it is never merged
// with the cloud and never pushed into the account now signed in. That is the
// whole of the fix for one trader's journal landing in another's database.
function readLocalArray<T>(localKey: string): T[] {
  if (typeof window === 'undefined') return [];
  const v = readOwned<T[]>(localKey);
  return Array.isArray(v) ? v : [];
}
function writeLocal(localKey: string, value: unknown): void {
  writeOwned(localKey, value);
}

/** Nothing local is trusted, merged or pushed while nobody is signed in — or
 *  while this tab is stale, meaning the browser signed into a different
 *  account after this document was rendered. See ./owned. */
function signedOut(): boolean {
  return owner() === null || stale();
}

async function fetchCloud(kind: string): Promise<unknown> {
  try {
    const res = await ownedFetch(`/api/collections?kind=${encodeURIComponent(kind)}`);
    if (!res.ok) return undefined;
    const data = await res.json().catch(() => ({}));
    return data?.collections?.[kind];
  } catch {
    return undefined;
  }
}

/** Merge a cloud list into the local cache (newest-wins, deduped by id,
    tombstones preserved) and return the visible items. Writes the merged result
    back to both local and (if it changed) the cloud. Full store — including
    tombstones — is kept in localStorage under `localKey`. */
export async function hydrateList<T extends Syncable>(kind: string, localKey: string): Promise<T[]> {
  if (signedOut()) return [];
  const local = readLocalArray<T>(localKey);
  void flushPending();
  const cloudRaw = await fetchCloud(kind);
  if (!Array.isArray(cloudRaw)) {
    // No cloud data (offline / not configured / first run) — keep local as-is,
    // but seed the cloud from local so it's no longer device-only.
    if (local.length) void pushCollection(kind, local);
    return active(local);
  }
  const cloud = cloudRaw as T[];
  const merged = mergeById(local, cloud);
  writeLocal(localKey, merged);
  if (needsPush(merged, cloud)) void pushCollection(kind, merged);
  return active(merged);
}

/** Persist a list: write the full store (with tombstones) locally and push. */
export async function saveList<T extends Syncable>(kind: string, localKey: string, items: T[]): Promise<void> {
  writeLocal(localKey, items);
  await pushCollection(kind, items);
}

/** Content signature that ignores sync metadata (updatedAt/deleted). */
function sigOf<T extends Syncable>(t: T): string {
  const { updatedAt: _u, deleted: _d, ...rest } = t as Syncable & Record<string, unknown>;
  return JSON.stringify(rest);
}

/** Reconcile the UI's new ACTIVE list against the stored (tombstoned) list:
    stamp new/changed items with a fresh updatedAt, tombstone anything the UI
    dropped (so the delete propagates instead of a peer resurrecting it), then
    persist the full store and push. The page keeps working with plain active
    arrays — this hides the tombstone bookkeeping. */
export async function commitList<T extends Syncable>(kind: string, localKey: string, nextActive: T[]): Promise<void> {
  const store = readLocalArray<T>(localKey);
  const prevById = new Map(store.map(s => [String(s.id), s]));
  const now = Date.now();
  const nextIds = new Set(nextActive.map(t => String(t.id)));

  const stamped = nextActive.map(t => {
    const prev = prevById.get(String(t.id));
    const changed = !prev || prev.deleted || sigOf(prev) !== sigOf(t);
    return changed ? { ...t, updatedAt: now, deleted: false } : t;
  });
  const removed = store
    .filter(s => !nextIds.has(String(s.id)))
    .map(s => (s.deleted ? s : { ...s, deleted: true, updatedAt: now }));

  await saveList(kind, localKey, [...stamped, ...removed] as T[]);
}

// ── Single-object docs (preferences, lockout, a day's plan) ──────────────────

function readLocalDoc<T>(localKey: string): (T & { updatedAt?: number }) | null {
  if (typeof window === 'undefined') return null;
  return readOwned<T & { updatedAt?: number }>(localKey);
}

export async function hydrateDoc<T extends { updatedAt?: number }>(kind: string, localKey: string): Promise<T | null> {
  if (signedOut()) return null;
  const local = readLocalDoc<T>(localKey);
  void flushPending();
  const cloudRaw = await fetchCloud(kind);
  const cloud = (cloudRaw && typeof cloudRaw === 'object' && !Array.isArray(cloudRaw)) ? cloudRaw as T : null;
  const winner = newerDoc(local, cloud);
  if (winner) writeLocal(localKey, winner);
  if (winner && winner !== cloud) void pushCollection(kind, winner);
  return winner;
}

export async function saveDoc<T extends object>(kind: string, localKey: string, doc: T): Promise<void> {
  const stamped = { ...doc, updatedAt: Date.now() };
  writeLocal(localKey, stamped);
  await pushCollection(kind, stamped);
}

// ── Dashboard state (name, reminders, today's plan/focus) as one doc ─────────
// These live across many localStorage keys (some per-date). Rather than sync
// each, we snapshot the relevant keys as raw strings into a single 'dashboard'
// doc. Raw-string values are format-agnostic, so no per-key parsing.
// Regenerable AI caches (onyx_ai_*) are deliberately excluded.
//
// EVERY KEY CARRIES ITS OWN TIMESTAMP, AND THAT IS THE WHOLE DESIGN.
//
// The document used to hold one `updatedAt` for all of it, and the newer
// document won outright. So each device pushed its own view of the world
// wholesale, and the cloud copy was only ever as complete as whichever device
// wrote last:
//
//   phone     writes today's plan at 07:00 and pushes.
//   laptop    has never seen it. It writes a reminder at 09:00, snapshots the
//             keys IT has — which do not include the plan — and pushes.
//   cloud     now holds the laptop's document. The plan is gone from it.
//
// The phone still has the plan on disk, so the next push from the phone puts
// it back and the loss is invisible. Until the phone's cache is cleared —
// which the epoch bump does to every device at once — and then it hydrates
// from a cloud copy that never had it.
//
// Merging per key removes the race entirely: a key is only ever overwritten by
// a NEWER version of that same key, so two devices editing two different
// things cannot destroy each other's work no matter who pushes last.

const DASH_DOC_KEY = 'onyx_dash_doc';
const DASH_PREFIXES = ['onyx_dash_', 'onyx_focus_'];
const DASH_EXACT = ['onyx_user_name'];
const DASH_EXCLUDE = new Set([DASH_DOC_KEY]);

/** The dashboard keys, as raw strings.
 *
 *  Raw is deliberate — these keys hold several different shapes and the
 *  snapshot is format-agnostic. But raw is also how a value belonging to
 *  ANOTHER account would be swept up and pushed into this one, which is the
 *  leak this whole layer exists to stop. So each value is checked for the
 *  owner envelope before it is included: a foreign one is skipped, and a
 *  plain unenveloped value (a device preference, an old record) is kept. */
function snapshotDashboard(): Record<string, string> {
  const me = owner();
  const out: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k || DASH_EXCLUDE.has(k) || k.startsWith('onyx_ai_')) continue;
    if (!(DASH_EXACT.includes(k) || DASH_PREFIXES.some(p => k.startsWith(p)))) continue;
    const v = window.localStorage.getItem(k);
    if (v == null) continue;
    if (!belongsToOther(v, me)) out[k] = v;
  }
  return out;
}

/** True when the raw string is an owner envelope stamped for someone else. */
function belongsToOther(raw: string, me: string | null): boolean {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const o = (parsed as { o?: unknown }).o;
    return typeof o === 'string' && 'v' in (parsed as object) && o !== me;
  } catch {
    return false;   // not JSON at all — a plain device value
  }
}

/** One key's value and when it last changed. `v: null` is a tombstone — the
 *  key was removed here, which has to travel or a cleared note comes back on
 *  the next merge. */
interface DashEntry { v: string | null; at: number }
interface DashDoc { keys: Record<string, DashEntry>; updatedAt: number }

/** Reads either shape.
 *
 *  Documents written before per-key stamps are `{ keys: { k: "value" } }` with
 *  a single `updatedAt`. Every key in one is stamped with that timestamp,
 *  which is exactly what it means: this is when this device last knew all of
 *  these to be true. From then on each key moves on its own. */
function normalizeDoc(raw: unknown): DashDoc {
  const empty: DashDoc = { keys: {}, updatedAt: 0 };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const d = raw as { keys?: unknown; updatedAt?: unknown };
  const at = typeof d.updatedAt === 'number' ? d.updatedAt : 0;
  if (!d.keys || typeof d.keys !== 'object' || Array.isArray(d.keys)) return { keys: {}, updatedAt: at };

  const keys: Record<string, DashEntry> = {};
  for (const [k, v] of Object.entries(d.keys as Record<string, unknown>)) {
    if (typeof v === 'string') { keys[k] = { v, at }; continue; }          // old shape
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const e = v as { v?: unknown; at?: unknown };
      const value = typeof e.v === 'string' ? e.v : e.v === null ? null : undefined;
      if (value !== undefined) keys[k] = { v: value, at: typeof e.at === 'number' ? e.at : at };
    }
  }
  return { keys, updatedAt: at };
}

/** Newest wins, one key at a time. */
function mergeDocs(a: DashDoc, b: DashDoc): DashDoc {
  const keys: Record<string, DashEntry> = {};
  for (const k of new Set([...Object.keys(a.keys), ...Object.keys(b.keys)])) {
    const x = a.keys[k], y = b.keys[k];
    keys[k] = !x ? y : !y ? x : (y.at > x.at ? y : x);
  }
  return { keys, updatedAt: Math.max(a.updatedAt, b.updatedAt) };
}

/** The current device state as a stamped document: a key whose value has not
 *  changed keeps the timestamp it already had, so an untouched key never wins
 *  a merge it should lose. */
function stampSnapshot(prev: DashDoc, now: number): DashDoc {
  const live = snapshotDashboard();
  const keys: Record<string, DashEntry> = {};
  for (const [k, v] of Object.entries(live)) {
    const before = prev.keys[k];
    keys[k] = before && before.v === v ? before : { v, at: now };
  }
  // Present before and gone now — recorded as removed rather than dropped, or
  // the other device's copy would resurrect it on the next merge.
  for (const [k, e] of Object.entries(prev.keys)) {
    if (k in live) continue;
    keys[k] = e.v === null ? e : { v: null, at: now };
  }
  return { keys, updatedAt: now };
}

let dashTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced push of the current dashboard snapshot (coalesces keystrokes). */
export function pushDashboard(): void {
  if (typeof window === 'undefined' || signedOut()) return;
  if (dashTimer) clearTimeout(dashTimer);
  dashTimer = setTimeout(() => {
    const doc = stampSnapshot(normalizeDoc(readLocalDoc(DASH_DOC_KEY)), Date.now());
    writeLocal(DASH_DOC_KEY, doc);
    void pushCollection('dashboard', doc);
  }, 800);
}

/** Reconcile the cloud dashboard document with this device's, one key at a
    time, apply the winners to localStorage, and push the result back when the
    merge produced anything the cloud did not have. Returns true when
    localStorage changed, so the caller knows to re-read. */
export async function hydrateDashboard(): Promise<boolean> {
  if (typeof window === 'undefined' || signedOut()) return false;
  const now = Date.now();
  // Stamped first: keys this device changed since its last push would
  // otherwise carry the old document's timestamps into the merge and lose to
  // a cloud copy that never saw them.
  const local = stampSnapshot(normalizeDoc(readLocalDoc(DASH_DOC_KEY)), now);
  void flushPending();
  const cloud = normalizeDoc(await fetchCloud('dashboard'));
  const merged = mergeDocs(local, cloud);

  let changed = false;
  for (const [k, e] of Object.entries(merged.keys)) {
    const current = window.localStorage.getItem(k);
    try {
      if (e.v === null) {
        if (current !== null) { window.localStorage.removeItem(k); changed = true; }
      } else if (current !== e.v) {
        // A value carrying somebody else's owner envelope is not applied. It
        // stays in the document — removing it here would tombstone another
        // account's key — but it never reaches this device's storage.
        if (belongsToOther(e.v, owner())) continue;
        window.localStorage.setItem(k, e.v);
        changed = true;
      }
    } catch { /* quota, private mode — the rest of the merge still applies */ }
  }

  writeLocal(DASH_DOC_KEY, merged);
  // Only when this device contributed something. An unchanged merge means the
  // cloud already had everything, and pushing it back would be a write per
  // page load on every device.
  if (JSON.stringify(merged.keys) !== JSON.stringify(cloud.keys)) {
    void pushCollection('dashboard', merged);
  }
  return changed;
}

let listenersBound = false;
/** Flush any queued writes when connectivity returns. Safe to call repeatedly —
    the listener is bound at most once. */
export function initSyncListeners(): void {
  if (typeof window === 'undefined' || listenersBound) return;
  listenersBound = true;
  window.addEventListener('online', () => { void flushPending(); });
}
