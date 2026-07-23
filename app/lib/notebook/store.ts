// ─────────────────────────────────────────────────────────────────────────────
// Notebook store — folders + entries, backed by the generic user_collections
// sync (same infra as rules/playbook/reminders). localStorage is the fast
// cache; the cloud is the source of truth. Built-in folders always exist for
// every user; custom ones are user-owned and can be created, renamed, deleted.
// Trade-log entries are seeded from the user's real trades so notes attach to
// a specific trade — that's the "notebook reads what you did" contract.
// ─────────────────────────────────────────────────────────────────────────────

import type { Syncable } from '../sync/merge';
import type { TradeEntry } from '../journal';

/* ── Types ─────────────────────────────────────────────────────── */
export type FolderSwatch = 'f-gold' | 'f-purple' | 'f-green' | 'f-blue' | 'f-red' | '';

export interface NotebookFolder extends Syncable {
  id: string;
  name: string;
  icon: string;          // emoji
  swatch: FolderSwatch;  // colored rail
  builtin?: boolean;     // cannot be renamed or deleted
  synced?: boolean;      // auto-populated from another source (e.g. trades)
  sortOrder: number;
  updatedAt?: number;
  deleted?: boolean;
}

export interface NotebookEntry extends Syncable {
  id: string;
  folderId: string;
  title: string;
  bodyHtml: string;
  tags: string[];
  /** When present, this entry is bound to a specific trade in the user's
   *  journal — the "note attached to a trade" case. Auto-seeded for trades
   *  in the built-in `trades` folder. */
  tradeId?: number;
  /** The date the note applies to (YYYY-MM-DD) — for daily/session folders. */
  dateISO?: string;
  createdAt: number;
  updatedAt?: number;
  deleted?: boolean;
}

/* ── Built-in folders (identical for every user, cannot be deleted) ── */
export const BUILTIN_FOLDERS: NotebookFolder[] = [
  { id: 'trades', name: 'יומן עסקאות', icon: '📊', swatch: 'f-gold',   builtin: true, synced: true, sortOrder: 0 },
  { id: 'daily',  name: 'יומן יומי',   icon: '📝', swatch: 'f-purple', builtin: true, sortOrder: 1 },
  { id: 'plan',   name: 'תוכנית מסחר', icon: '📐', swatch: 'f-green',  builtin: true, sortOrder: 2 },
  { id: 'notes',  name: 'ההערות שלי',  icon: '📔', swatch: 'f-blue',   builtin: true, sortOrder: 3 },
];

export const BUILTIN_FOLDER_IDS = new Set(BUILTIN_FOLDERS.map(f => f.id));

/* ── Storage keys ─────────────────────────────────────────────── */
export const CUSTOM_FOLDERS_KIND = 'notebook_folders_v1';
export const CUSTOM_FOLDERS_KEY  = 'onyx_notebook_folders_v1';
export const ENTRIES_KIND        = 'notebook_entries_v1';
export const ENTRIES_KEY         = 'onyx_notebook_entries_v1';

/* ── Merge: built-ins with user's custom folders (custom appended after) ── */
export function mergedFolders(customFolders: NotebookFolder[]): NotebookFolder[] {
  const customActive = customFolders.filter(f => !BUILTIN_FOLDER_IDS.has(f.id));
  return [
    ...BUILTIN_FOLDERS,
    ...customActive.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name))),
  ];
}

/* ── Trade-log entries: seed one entry per trade so notes attach to a trade.
   The seeded entry sits alongside user-written entries in the same store; the
   user can add text/tags to it just like any other entry. */
export function seedTradeEntries(trades: TradeEntry[], existing: NotebookEntry[]): NotebookEntry[] {
  const byTradeId = new Map<number, NotebookEntry>();
  for (const e of existing) {
    if (e.folderId === 'trades' && typeof e.tradeId === 'number') byTradeId.set(e.tradeId, e);
  }
  const now = Date.now();
  const seeded: NotebookEntry[] = [];
  for (const t of trades) {
    if (byTradeId.has(t.id)) continue;
    const dir = t.direction === 'LONG' ? 'לונג' : 'שורט';
    seeded.push({
      id: `trade-${t.id}`,
      folderId: 'trades',
      title: `עסקה #${t.id} · ${t.symbol} · ${dir}`,
      bodyHtml: '',
      tags: [],
      tradeId: t.id,
      dateISO: t.dateISO,
      createdAt: now,
      updatedAt: now,
    });
  }
  return seeded;
}

/* ── Entry helpers ────────────────────────────────────────────── */
export function newEntry(folderId: string, opts: Partial<NotebookEntry> = {}): NotebookEntry {
  const now = Date.now();
  return {
    id: `custom-${now}-${Math.random().toString(36).slice(2, 7)}`,
    folderId,
    title: opts.title ?? '',
    bodyHtml: opts.bodyHtml ?? '',
    tags: opts.tags ?? [],
    dateISO: opts.dateISO,
    createdAt: now,
    updatedAt: now,
  };
}

export function newFolder(name: string, icon: string, swatch: FolderSwatch, sortOrder: number): NotebookFolder {
  return {
    id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    icon,
    swatch,
    sortOrder,
    updatedAt: Date.now(),
  };
}
