// ─────────────────────────────────────────────────────────────────────────────
// Client sync for the generic user_collections store. localStorage is a cache;
// the cloud is the source of truth. hydrate* merges cloud into local on load;
// save* writes local immediately and pushes to the cloud, queueing the write as
// `pending` if the network fails so nothing is lost silently — the queue is
// flushed on the next save/hydrate and whenever the browser comes back online.
// ─────────────────────────────────────────────────────────────────────────────

import { mergeById, active, needsPush, newerDoc, type Syncable } from './merge';

const PENDING_KEY = 'onyx_sync_pending';

type Pending = Record<string, unknown>; // kind → last data (last-write-wins per kind)

function readPending(): Pending {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(window.localStorage.getItem(PENDING_KEY) || '{}') as Pending; } catch { return {}; }
}
function writePending(p: Pending): void {
  try { window.localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* quota — non-fatal */ }
}
function queue(kind: string, data: unknown): void {
  const p = readPending(); p[kind] = data; writePending(p);
}

async function put(kind: string, data: unknown): Promise<boolean> {
  try {
    const res = await fetch('/api/collections', {
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

function readLocalArray<T>(localKey: string): T[] {
  if (typeof window === 'undefined') return [];
  try { const raw = window.localStorage.getItem(localKey); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function writeLocal(localKey: string, value: unknown): void {
  try { window.localStorage.setItem(localKey, JSON.stringify(value)); } catch { /* quota — non-fatal */ }
}

async function fetchCloud(kind: string): Promise<unknown> {
  try {
    const res = await fetch(`/api/collections?kind=${encodeURIComponent(kind)}`);
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

// ── Single-object docs (preferences, lockout, a day's plan) ──────────────────

function readLocalDoc<T>(localKey: string): (T & { updatedAt?: number }) | null {
  if (typeof window === 'undefined') return null;
  try { const raw = window.localStorage.getItem(localKey); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function hydrateDoc<T extends { updatedAt?: number }>(kind: string, localKey: string): Promise<T | null> {
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

/** Call once on app mount to flush any queued writes when connectivity returns. */
export function initSyncListeners(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => { void flushPending(); });
}
