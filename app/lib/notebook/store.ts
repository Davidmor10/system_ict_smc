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
/* ── Template building blocks ─────────────────────────────────────────────────
   Two rules govern every line below, and both come from the same place: this
   HTML is dropped straight into a contenteditable that the trader then types
   into.

   1. ONE BLOCK PER LINE. Each question is its own <p>/<h3> and every question
      is followed by an empty line that is already there. Enter inside a block
      splits it into a sibling, so the trader lands on a writable line by
      clicking — they never have to make room first, and a stray Enter cannot
      merge two questions into one paragraph.

   2. LATIN RUNS ARE ISOLATED. "Max loss ליום" in an RTL block is a bidi
      problem: the browser reorders the run against the surrounding Hebrew and
      the trader sees "ליום Max loss", or worse once they type around it.
      dir="ltr" on an INLINE span isolates the ordering without touching
      alignment — which is exactly the distinction that makes it safe here,
      where the same attribute on a block would flip the whole line left.
   ────────────────────────────────────────────────────────────────────────── */

/** A Latin word or phrase sitting inside Hebrew text. */
const en = (text: string) => `<span dir="ltr">${text}</span>`;

/** An empty line, already present, for the answer. */
const LINE = '<p><br></p>';

/** A numbered question plus its blank answer line. `hint` renders muted under
 *  the question: the difference between a question a trader answers and one
 *  they skip is usually an example of what a good answer looks like. */
const q = (n: number, question: string, hint?: string) =>
  `<h3>${n}. ${question}</h3>` + (hint ? `<p class="nb-hint">${hint}</p>` : '') + LINE;

const PRE_MARKET_QUESTIONS = [
  q(1, `אילו ${en('setups')} אני מחפש היום?`),
  q(2, `${en('Watchlist')} — טיקרים ורמות ספציפיות`),
  q(3, `${en('Max loss')} ליום`, `בדולרים / ${en('R')}:`),
  q(4, 'חדשות ואירועים לתשומת לב'),
  q(5, 'איך אני מרגיש?', 'עייף · חרד · בטוח · מוסח'),
].join('');

const POST_SESSION_QUESTIONS = [
  q(1, 'האם עקבתי אחרי תוכנית המסחר?', 'כן / לא — ומדוע'),
  q(2, 'מה עבד טוב בסשן הזה?', 'לדוגמה: סבלנות לכניסה, ניהול סיכונים נכון'),
  q(3, 'היו עסקאות רגשיות / חריגות?', `לדוגמה: כניסת ${en('FOMO')} בעסקה הראשונה`),
  q(4, 'מה הייתי משנה?'),
  // Asked after the close, not before it. Before the session it is a guess at
  // how the day will go; after it, it is the one reading the trader can give
  // that no number in the journal can — how they actually held up.
  q(5, 'מצב מנטלי ופוקוס', 'לדוגמה: מפוקס, ישנתי טוב / עייף, לשמור על סיכון נמוך'),
].join('');

export const BUILTIN_TEMPLATES: NotebookTemplate[] = [
  {
    id: 'pre',
    name: 'תבנית Pre-Market',
    builtin: true,
    html: [
      `<h2>${en('Pre-Market')} — התכוננות</h2>`,
      PRE_MARKET_QUESTIONS,
    ].join(''),
  },
  {
    id: 'post',
    name: 'תבנית Post-Session',
    builtin: true,
    html: [
      `<h2>${en('Post-Session Review')} — סיכום</h2>`,
      POST_SESSION_QUESTIONS,
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

/* ══ Per-user preferences — remembered across sessions/devices via the same
   user_collections cloud sync (scoped by clerk_id, so switching users on the
   same browser never leaks state). ══ */
export interface NotebookPrefs {
  folderId?: string;
  entryId?: string | null;
  filterTag?: string | null;
  updatedAt?: number;
}
export const PREFS_KIND = 'notebook_prefs_v1';
export const PREFS_KEY  = 'onyx_notebook_prefs_v1';
