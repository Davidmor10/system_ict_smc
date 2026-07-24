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

/* ══ Hebrew date label — the format the trader asked for ══
   "יום ד׳, 19 ביוני 2024" — used as the auto-title for a new entry in
   the built-in "יומן יומי" folder. */
export function hebrewDateLabel(date: Date): string {
  const dows = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return `יום ${dows[date.getDay()]}׳, ${date.getDate()} ב${months[date.getMonth()]} ${date.getFullYear()}`;
}

/* ══ Templates — the trader-signed defaults we designed together ══ */
export interface NotebookTemplate {
  id: string;
  name: string;
  html: string;
  builtin?: boolean;
}
export const BUILTIN_TEMPLATES: NotebookTemplate[] = [
  {
    id: 'pre-post',
    name: 'Pre-Market & Post-Session',
    builtin: true,
    html: [
      '<h3>Pre-Market — התכוננות</h3>',
      'Setups לחיפוש · Watchlist · Max loss · חדשות · הרגשה',
      '<br><br>',
      '<h3>Post-Session Review — סיכום</h3>',
      'עקבתי אחרי התוכנית? · מה הלך טוב? · מה הייתי משנה? · עסקאות רגשיות?',
    ].join(''),
  },
  {
    id: 'pre',
    name: 'תבנית Pre-Market',
    builtin: true,
    html: [
      '<h3>1. אילו setups אני מחפש היום?</h3><br>',
      '<h3>2. Watchlist — טיקרים ורמות ספציפיות</h3><br>',
      '<h3>3. Max loss ליום</h3>בדולרים / R:<br><br>',
      '<h3>4. חדשות ואירועים לתשומת לב</h3><br>',
      '<h3>5. איך אני מרגיש?</h3>עייף · חרד · בטוח · מוסח:<br>',
    ].join(''),
  },
  {
    id: 'all',
    name: 'All-in-One יומי',
    builtin: true,
    html: [
      '<h3>Pre-Market — 5 שאלות</h3>',
      '1. Setups?<br>2. Watchlist?<br>3. Max loss?<br>4. חדשות?<br>5. הרגשה?<br><br>',
      '<h3>Trade Log — לכל עסקה</h3>',
      'תאריך · טיקר · כיוון · Entry · Exit · Size · P&amp;L · Setup tag · Emotion tag<br><br>',
      '<h3>Post-Session — 4 שאלות</h3>',
      '1. עקבתי אחרי התוכנית?<br>2. מה עשיתי טוב?<br>3. מה הייתי משנה?<br>4. עסקאות רגשיות?<br>',
    ].join(''),
  },
];
export const TEMPLATES_KIND = 'notebook_templates_v1';
export const TEMPLATES_KEY  = 'onyx_notebook_templates_v1';

/* ══ Default tag library — always visible in the sidebar, clickable filter ══ */
export type TagCls = 'gold' | 'green' | 'red';
export interface DefaultTag { name: string; cls: TagCls; }
export const DEFAULT_TAGS: DefaultTag[] = [
  { name: 'FOMC',          cls: 'gold' },
  { name: 'FVG',           cls: 'gold' },
  { name: 'Reversal',      cls: 'green' },
  { name: 'BOS',           cls: 'green' },
  { name: 'Opening Drive', cls: 'red' },
  { name: 'FOMO',          cls: 'red' },
];
