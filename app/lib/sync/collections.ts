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
// doc and reconcile newest-wins. Raw-string values are format-agnostic, so no
// per-key parsing. Regenerable AI caches (onyx_ai_*) are deliberately excluded.

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

let dashTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced push of the current dashboard snapshot (coalesces keystrokes). */
export function pushDashboard(): void {
  if (typeof window === 'undefined' || signedOut()) return;
  if (dashTimer) clearTimeout(dashTimer);
  dashTimer = setTimeout(() => {
    const doc = { keys: snapshotDashboard(), updatedAt: Date.now() };
    writeLocal(DASH_DOC_KEY, doc);
    void pushCollection('dashboard', doc);
  }, 800);
}

/** Pull the cloud dashboard doc; if it's newer than the local snapshot, apply
    its keys into localStorage and return true (caller should re-read). If local
    is newer, push it up. */
export async function hydrateDashboard(): Promise<boolean> {
  if (typeof window === 'undefined' || signedOut()) return false;
  const shadow = readLocalDoc<{ keys?: Record<string, string> }>(DASH_DOC_KEY);
  void flushPending();
  const cloudRaw = await fetchCloud('dashboard');
  const cloud = (cloudRaw && typeof cloudRaw === 'object' && !Array.isArray(cloudRaw))
    ? cloudRaw as { keys?: Record<string, string>; updatedAt?: number } : null;
  const localTs = shadow?.updatedAt ?? 0;
  const cloudTs = cloud?.updatedAt ?? 0;
  if (cloud?.keys && cloudTs > localTs) {
    // Restored as raw strings, which is safe in both directions: a value that
    // carries an owner envelope keeps it, so a poisoned cloud doc lands as
    // somebody else's and every reader ignores it rather than displaying it.
    for (const [k, v] of Object.entries(cloud.keys)) {
      if (belongsToOther(v, owner())) continue;
      try { window.localStorage.setItem(k, v); } catch { /* quota */ }
    }
    writeLocal(DASH_DOC_KEY, cloud);
    return true;
  }
  if (shadow && localTs > cloudTs) void pushCollection('dashboard', shadow);
  return false;
}

let listenersBound = false;
/** Flush any queued writes when connectivity returns. Safe to call repeatedly —
    the listener is bound at most once. */
export function initSyncListeners(): void {
  if (typeof window === 'undefined' || listenersBound) return;
  listenersBound = true;
  window.addEventListener('online', () => { void flushPending(); });
}
