'use client';

import './notebook.css';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { loadTrades, hydrateTradesFromCloud, tradePnL } from '../lib/journal';
import type { TradeEntry } from '../lib/journal';
import { hydrateList, commitList, hydrateDoc, saveDoc, initSyncListeners } from '../lib/sync/collections';
import {
  BUILTIN_FOLDERS, mergedFolders, seedTradeEntries, newEntry, newFolder,
  CUSTOM_FOLDERS_KIND, CUSTOM_FOLDERS_KEY, ENTRIES_KIND, ENTRIES_KEY,
  BUILTIN_TEMPLATES, DEFAULT_TAGS, hebrewDateLabel,
  TEMPLATES_KIND, TEMPLATES_KEY, PREFS_KIND, PREFS_KEY,
  type NotebookFolder, type NotebookEntry, type FolderSwatch, type NotebookTemplate, type NotebookPrefs,
} from '../lib/notebook/store';

/* ══════════════════════════════════════════════════════════════════
   Emoji picker data + color palette
══════════════════════════════════════════════════════════════════ */
const EMOJI: Record<string, string[]> = {
  frequent: ['📁','📂','📊','📈','📉','📝','📔','📓','📒','📕','📗','📘','📙','📚','📖','🎯','⚡','💡','⭐','🔥','💰','💎','🏆','✅','☑️','📌','📍','🔖','🏷','💼'],
  smileys: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','🥺','😢','😭','😱','😖','😣','😞','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👻','👽','👾','🤖','🎃'],
  hands: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👋','🤚','🖐','✋','🖖','👏','🙌','🤝','🙏','✍️','💅','🤳','💪','🧠','🫀','👀','👁','👅','👄','💋'],
  animals: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦅','🦉','🦇','🐺','🐴','🦄','🐝','🐛','🦋','🐢','🐍','🦖','🐙','🦑','🦐','🦞','🦀','🐠','🐬','🐳','🐋','🦈','🐘','🦒','🦘','🐕','🐈','🌲','🌳','🌴','🌱','🌿','🍀','🍁','🌸','🌺','🌻','🌹','🌷','🍄','🌍','🌙','☀️','⭐','🌟','✨','⚡','🔥','❄️','☂️','🌊'],
  food: ['🍎','🍊','🍋','🍌','🍉','🍇','🍓','🍑','🥭','🍍','🥝','🍅','🥑','🥦','🥕','🌽','🌶','🥔','🍞','🥐','🥖','🧀','🥚','🍳','🥞','🥓','🍗','🍖','🌭','🍔','🍟','🍕','🌮','🌯','🥗','🍝','🍜','🍣','🍱','🍤','🍚','🍥','🍰','🎂','🧁','🍩','🍪','🍫','🍿','☕','🍵','🥤','🍺','🥂','🍷','🥃','🍸','🍹'],
  activities: ['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🥊','🥋','⛳','🏹','🎣','🤿','🎿','🏂','🏄','🏊','🚴','🚵','🏋️','🤸','🎯','🎳','🎮','🎰','🧩','🎨','🎬','🎤','🎧','🎼','🎵','🎶','🎹','🥁','🎷','🎺','🎸','🎻'],
  travel: ['🚗','🚕','🚙','🚌','🚎','🚓','🚑','🚒','🚚','🚜','🚲','🏍','✈️','🚀','🚁','⛵','🚤','🚢','⚓','🗿','🗽','🏰','🎡','🎢','🎠','🏖','🏝','🏔','🏕','🏠','🏢','🏥','🏨','🏫','⛪','🌉','🎇','🎆','🌃'],
  objects: ['⌚','📱','💻','⌨️','🖥','🖨','📷','📹','🎥','📺','📻','🎙','⏰','⌛','🔋','🔌','💡','🔦','💰','💵','💳','💎','⚖️','🔧','🔨','⚙️','🧲','🔫','🧪','🔬','🔭','💊','💉','🚿','🛁','🛒','🎁','🎈','🎀','✉️','📧','📮','📦','📎','📌','📍','✂️','🖊','✏️','📝','📚','🔍','🔒','🔑'],
  symbols: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕','💞','💓','💗','💖','💝','☮️','✝️','☪️','🕉️','☸️','✡️','☯️','⚛️','⭕','❌','🛑','⛔','❗','❓','‼️','⚠️','🚸','♻️','✅','☑️','✔️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','▶️','⏸','⏹','⏺','⏭','⏮','⏩','⏪','🔀','🔁','➕','➖','♾','💯'],
};
const EMOJI_TABS: { key: string; label: string; name: string }[] = [
  {key:'frequent',   label:'⭐', name:'שימוש תדיר'},
  {key:'smileys',    label:'😀', name:'סמיילים'},
  {key:'hands',      label:'👋', name:'ידיים'},
  {key:'animals',    label:'🐶', name:'חיות וטבע'},
  {key:'food',       label:'🍔', name:'אוכל'},
  {key:'activities', label:'⚽', name:'פעילויות'},
  {key:'travel',     label:'✈️', name:'נסיעות'},
  {key:'objects',    label:'💡', name:'חפצים'},
  {key:'symbols',    label:'❤️', name:'סמלים'},
];

const NEUTRALS = ['#ffffff','#f7f4ee','#efe9dc','#e2d8c1','#c9baa0','#a89982','#7d715f','#5c5344','#3d372d','#1e1a15','#f5efe4','#dcc9a3','#b89b6a','#8b7245','#5f4d2d','#3a2f1c','#f0e6d2','#c4b18a'];
const HUES = [{h:0,s:78},{h:12,s:82},{h:24,s:85},{h:36,s:88},{h:48,s:88},{h:64,s:70},{h:82,s:60},{h:105,s:52},{h:135,s:52},{h:158,s:55},{h:175,s:58},{h:192,s:65},{h:208,s:72},{h:222,s:70},{h:245,s:60},{h:268,s:55},{h:295,s:52},{h:325,s:58}];
const TINTS = [90,80,68,56,44,32,22];

const TAG_GOLD = ['FOMC','FVG','A+','ברירת מחדל','יעדים','אסטרטגיה','פעיל','דחוף','חיובי','מפורט','תוכנית','חוקים','רעיון','חדש'];
const TAG_GREEN = ['Reversal','BOS','משמעת','פעילה','סבלנות','הושלם','B','לימוד','שיפור'];
function tagClass(t: string): '' | 'gold' | 'green' | 'red' {
  if (TAG_GOLD.includes(t)) return 'gold';
  if (TAG_GREEN.includes(t)) return 'green';
  return 'red';
}

/* ══════════════════════════════════════════════════════════════════
   Component
══════════════════════════════════════════════════════════════════ */
export default function NotebookView() {
  /* Data ─────────────────────────────────────────────────────────── */
  const [customFolders, setCustomFolders] = useState<NotebookFolder[]>([]);
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  /** Entries have come back from the cloud. Until this is true, `entries` is
   *  an empty array that means "not loaded yet", not "the user has none" —
   *  and anything that writes the list back must wait. */
  const [entriesHydrated, setEntriesHydrated] = useState(false);
  const [trades, setTrades] = useState<TradeEntry[]>([]);

  /* UI state ─────────────────────────────────────────────────────── */
  const [currentFolderId, setCurrentFolderId] = useState<string>('trades');
  const [currentEntryId, setCurrentEntryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [autosaveVisible, setAutosaveVisible] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<(NotebookTemplate & { updatedAt?: number; deleted?: boolean })[]>([]);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [templateNameModal, setTemplateNameModal] = useState<{ name: string } | null>(null);

  /* Modal state ─────────────────────────────────────────────────── */
  const [folderModal, setFolderModal] = useState<{ name: string; emoji: string; swatch: FolderSwatch; pickerTab: string; pickerSearch: string } | null>(null);
  const [tagModal, setTagModal] = useState<{ name: string; emoji: string; swatch: FolderSwatch; pickerTab: string; pickerSearch: string } | null>(null);
  const [confirmDlg, setConfirmDlg] = useState<{ title: string; msg: string; note?: string; onConfirm: () => void } | null>(null);
  const [colorPop, setColorPop] = useState<{ x: number; y: number; kind: 'color' | 'highlight' } | null>(null);

  /* Editor refs ─────────────────────────────────────────────────── */
  const edBodyRef = useRef<HTMLDivElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const saveChipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Live mirrors of state the save path needs. The unmount and pagehide
     handlers run with whatever closure they were registered with, and a
     stale `entries` there would write an old snapshot back over the user's
     text — so the save path reads these instead. */
  const currentEntryIdRef = useRef<string | null>(null);
  const patchEntryRef = useRef<(id: string, patch: Partial<NotebookEntry>) => void>(() => {});
  /** Unsaved text is sitting in the editor DOM. A ref, not just state,
   *  because the teardown handlers read it outside a render. */
  const dirtyRef = useRef(false);

  /* Hydrate on mount ────────────────────────────────────────────── */
  useEffect(() => {
    initSyncListeners();
    // Trades first — they seed the built-in "trades" folder
    setTrades(loadTrades());
    hydrateTradesFromCloud().then(m => { if (m) setTrades(m); }).catch(() => {});
    // Custom folders + entries + templates from cloud
    hydrateList<NotebookFolder>(CUSTOM_FOLDERS_KIND, CUSTOM_FOLDERS_KEY).then(setCustomFolders).catch(() => {});
    hydrateList<NotebookEntry>(ENTRIES_KIND, ENTRIES_KEY)
      .then(list => { setEntries(list); setEntriesHydrated(true); })
      .catch(() => setEntriesHydrated(true));
    hydrateList<NotebookTemplate & { updatedAt?: number; deleted?: boolean }>(TEMPLATES_KIND, TEMPLATES_KEY).then(setCustomTemplates).catch(() => {});
    // Per-user preferences: last folder / entry / tag filter
    hydrateDoc<NotebookPrefs>(PREFS_KIND, PREFS_KEY).then(prefs => {
      if (!prefs) return;
      if (prefs.folderId) setCurrentFolderId(prefs.folderId);
      if (prefs.entryId !== undefined) setCurrentEntryId(prefs.entryId ?? null);
      if (prefs.filterTag !== undefined) setFilterTag(prefs.filterTag ?? null);
      prefsHydratedRef.current = true;
    }).catch(() => { prefsHydratedRef.current = true; });
  }, []);

  /* Persist prefs whenever the trader switches folder / entry / tag — debounced
     so a burst of clicks (folder → tag → entry) collapses to one write. */
  const prefsHydratedRef = useRef(false);
  const prefsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
    prefsTimerRef.current = setTimeout(() => {
      void saveDoc<NotebookPrefs>(PREFS_KIND, PREFS_KEY, {
        folderId: currentFolderId,
        entryId: currentEntryId,
        filterTag,
      });
    }, 500);
  }, [currentFolderId, currentEntryId, filterTag]);

  /* Re-seed trade entries whenever trades change ──────────────────
     Gated on entriesHydrated, and that gate is the whole point.

     loadTrades() is synchronous while hydrateList() is a round-trip, so this
     effect used to fire with `entries` still [] — then write [...[], seeded]
     back to the cloud as the authoritative list. Every note the user had
     written was erased by opening the notebook. It looked like "the editor
     doesn't show what I saved"; the text was saved, and then deleted.

     An empty `entries` before hydration means "not loaded", never "none". */
  useEffect(() => {
    if (!entriesHydrated || !trades.length) return;
    setEntries(prev => {
      const seeded = seedTradeEntries(trades, prev);
      if (!seeded.length) return prev;
      const next = [...prev, ...seeded];
      // Persist without blocking; commitList takes the ACTIVE list (no tombstones here since they're new)
      void commitList<NotebookEntry>(ENTRIES_KIND, ENTRIES_KEY, next);
      return next;
    });
  }, [trades, entriesHydrated]);

  /* Derived ─────────────────────────────────────────────────────── */
  const folders = useMemo(() => mergedFolders(customFolders), [customFolders]);
  const folderById = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders]);
  const entriesByFolder = useMemo(() => {
    const map = new Map<string, NotebookEntry[]>();
    for (const e of entries) {
      const list = map.get(e.folderId) ?? [];
      list.push(e);
      map.set(e.folderId, list);
    }
    // Sort each folder's list: newest first (by dateISO desc, then by createdAt desc)
    for (const list of map.values()) {
      list.sort((a, b) => {
        const aKey = a.dateISO ?? '';
        const bKey = b.dateISO ?? '';
        if (aKey !== bKey) return bKey.localeCompare(aKey);
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      });
    }
    return map;
  }, [entries]);
  const currentFolder = folderById.get(currentFolderId) ?? BUILTIN_FOLDERS[0];
  const currentEntries = entriesByFolder.get(currentFolderId) ?? [];
  // When a tag is picked from the sidebar, override folder scope: show every
  // entry (across all folders) that carries the tag. Search still applies.
  const scopedEntries = filterTag
    ? entries.filter(e => e.tags.includes(filterTag))
    : currentEntries;
  const filteredEntries = search.trim()
    ? scopedEntries.filter(e => (e.title + ' ' + e.tags.join(' ') + ' ' + e.bodyHtml).toLowerCase().includes(search.toLowerCase()))
    : scopedEntries;

  /* All templates (builtin + custom) and tag library with live counts */
  const allTemplates = useMemo<NotebookTemplate[]>(() => [
    ...BUILTIN_TEMPLATES,
    ...customTemplates.filter(t => !t.deleted && !BUILTIN_TEMPLATES.some(b => b.id === t.id)),
  ], [customTemplates]);
  const allTagsWithCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    const seen = new Set<string>();
    const list: { name: string; cls: 'gold' | 'green' | 'red'; count: number }[] = [];
    for (const d of DEFAULT_TAGS) { list.push({ name: d.name, cls: d.cls, count: counts.get(d.name) ?? 0 }); seen.add(d.name); }
    // Any tag actually used by the trader that isn't in the defaults gets tacked on
    for (const [name, count] of counts) {
      if (seen.has(name)) continue;
      list.push({ name, cls: tagClass(name) as 'gold' | 'green' | 'red' || 'red', count });
    }
    return list;
  }, [entries]);
  const currentEntry = currentEntryId
    ? currentEntries.find(e => e.id === currentEntryId) ?? null
    : filteredEntries[0] ?? null;

  /* We intentionally do NOT auto-reset currentEntryId on folder change —
     the reset happens in the folder onClick handler so it's user-driven
     and doesn't wipe the entry we just hydrated from prefs. */

  /* Load entry content into editor when currentEntry changes ──────
     Before overwriting the editor, commit whatever the OUTGOING entry has
     in the DOM. Switching entries used to blow away unsaved text with no
     warning, same root cause as navigating away.

     Written against refs on purpose: this effect sits above the save
     helpers in the component body, so naming them in a dependency array
     would read them before they are initialized. */
  const loadedEntryIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!edBodyRef.current) return;
    const outgoing = loadedEntryIdRef.current;
    if (outgoing && outgoing !== (currentEntry?.id ?? null) && dirtyRef.current) {
      patchEntryRef.current(outgoing, { bodyHtml: edBodyRef.current.innerHTML });
    }
    dirtyRef.current = false;
    setDirty(false);
    edBodyRef.current.innerHTML = currentEntry?.bodyHtml ?? '';
    loadedEntryIdRef.current = currentEntry?.id ?? null;
    savedRangeRef.current = null;
  }, [currentEntry?.id]);

  /* Persist entries (debounced from body edits) ──────────────────── */
  const persistEntries = useCallback((next: NotebookEntry[]) => {
    setEntries(next);
    void commitList<NotebookEntry>(ENTRIES_KIND, ENTRIES_KEY, next);
  }, []);

  const patchEntry = useCallback((id: string, patch: Partial<NotebookEntry>) => {
    persistEntries(entries.map(e => (e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e)));
  }, [entries, persistEntries]);

  // Keep the save path's mirrors current.
  //
  // Tracks currentEntry?.id, NOT currentEntryId. Those differ: when nothing
  // has been clicked, currentEntry falls back to the first entry in the list
  // while currentEntryId stays null. Keying the save path off the id meant
  // that on the most common path of all — open the notebook, start typing in
  // whatever is already showing — every keystroke was ignored and the Save
  // button never lit up.
  patchEntryRef.current = patchEntry;
  useEffect(() => { currentEntryIdRef.current = currentEntry?.id ?? null; }, [currentEntry?.id]);

  const removeEntry = useCallback((id: string) => {
    persistEntries(entries.filter(e => e.id !== id));
    if (currentEntryId === id) setCurrentEntryId(null);
  }, [entries, persistEntries, currentEntryId]);

  const createEntry = useCallback((folderId: string, opts?: Partial<NotebookEntry>) => {
    const now = new Date();
    // Smart defaults: daily gets today's Hebrew date, plan gets month-year, others empty
    let defaultTitle = opts?.title ?? '';
    let defaultDateISO = opts?.dateISO;
    if (!opts?.title) {
      if (folderId === 'daily') {
        defaultTitle = hebrewDateLabel(now);
        defaultDateISO = defaultDateISO ?? now.toISOString().slice(0, 10);
      } else if (folderId === 'plan') {
        const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
        defaultTitle = `תוכנית מסחר · ${months[now.getMonth()]} ${now.getFullYear()}`;
      }
    }
    const created = newEntry(folderId, { ...opts, title: defaultTitle, dateISO: defaultDateISO });
    persistEntries([...entries, created]);
    setCurrentEntryId(created.id);
    return created;
  }, [entries, persistEntries]);

  /* Folder actions ──────────────────────────────────────────────── */
  const persistCustomFolders = useCallback((next: NotebookFolder[]) => {
    setCustomFolders(next);
    void commitList<NotebookFolder>(CUSTOM_FOLDERS_KIND, CUSTOM_FOLDERS_KEY, next);
  }, []);
  const removeFolder = useCallback((id: string) => {
    const f = folderById.get(id);
    if (!f || f.builtin) return;
    // Also drop entries in that folder (kept locally through the tombstone flow)
    persistEntries(entries.filter(e => e.folderId !== id));
    persistCustomFolders(customFolders.filter(cf => cf.id !== id));
    if (currentFolderId === id) setCurrentFolderId('trades');
  }, [folderById, entries, persistEntries, customFolders, persistCustomFolders, currentFolderId]);

  /* Saving the editor body ───────────────────────────────────────
     Explicit, not on a timer. The old behavior queued a write 700ms after
     the last keystroke, so leaving the page inside that window dropped the
     edit entirely — the timer never fired and the editor's DOM went away
     with it. Typing now only marks the entry dirty; the Save button (or
     Ctrl/Cmd+S) writes.

     flushSave still runs when the editor is about to lose the text it is
     holding — switching entries, unmounting, closing the tab. That is not
     autosave sneaking back in: it is the difference between "you decide
     when to save" and "your writing can vanish". Nothing here writes while
     you type. */
  const flushSave = useCallback((): boolean => {
    if (!dirtyRef.current) return false;
    const id = currentEntryIdRef.current;
    const html = edBodyRef.current?.innerHTML;
    if (!id || html == null) return false;
    dirtyRef.current = false;
    setDirty(false);
    patchEntryRef.current(id, { bodyHtml: html });
    return true;
  }, []);

  const saveNow = useCallback(() => {
    const wrote = flushSave();
    // Confirm either way. A Save press that reports nothing reads as broken,
    // even when the correct answer is "already saved".
    setAutosaveVisible(true);
    if (saveChipTimerRef.current) clearTimeout(saveChipTimerRef.current);
    saveChipTimerRef.current = setTimeout(() => setAutosaveVisible(false), wrote ? 1600 : 1000);
  }, [flushSave]);

  const markDirty = useCallback(() => {
    if (!currentEntryIdRef.current) return;
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  /* Ctrl/Cmd+S — the shortcut everyone's fingers already know. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow]);

  /* Last line of defence: the tab is closing or being hidden with unsaved
     text in the DOM. Nothing else gets a chance to run after this. */
  useEffect(() => {
    const onLeave = () => { flushSave(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      flushSave();
      e.preventDefault();
    };
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', onLeave);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      document.removeEventListener('visibilitychange', onLeave);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Unmount — navigating to another dashboard page. This is the exact
      // path that lost the user's writing.
      flushSave();
    };
  }, [flushSave]);

  /* Editor selection preservation (for toolbar) ─────────────────── */
  const saveRange = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !edBodyRef.current) return;
    const r = sel.getRangeAt(0);
    if (edBodyRef.current.contains(r.commonAncestorContainer)) savedRangeRef.current = r.cloneRange();
  }, []);
  const restoreRange = useCallback(() => {
    edBodyRef.current?.focus();
    if (!savedRangeRef.current) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(savedRangeRef.current);
  }, []);
  const exec = useCallback((cmd: string, val?: string | null) => {
    if (!edBodyRef.current) return;
    edBodyRef.current.focus();
    restoreRange();
    try { document.execCommand(cmd, false, val ?? undefined); } catch { /* silent */ }
    saveRange();
    markDirty();
  }, [restoreRange, saveRange, markDirty]);

  /* Font-size — wrap each text-node slice of the selection in a sized span,
     so a mixed h3/p/list selection all changes at once, and nested inner
     sizes don't override the new one. */
  const applySize = useCallback((px: number) => {
    px = Math.max(10, Math.min(60, px | 0));
    if (!edBodyRef.current) return;
    edBodyRef.current.focus();
    restoreRange();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      const span = document.createElement('span');
      span.style.fontSize = px + 'px';
      span.appendChild(document.createTextNode('​'));
      range.insertNode(span);
      const r = document.createRange();
      r.setStart(span.firstChild!, 1); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
      savedRangeRef.current = r.cloneRange();
      markDirty();
      return;
    }
    const { startContainer: startC, startOffset: startO, endContainer: endC, endOffset: endO } = range;
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(edBodyRef.current, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      if (!n.textContent) continue;
      const nr = document.createRange();
      nr.selectNodeContents(n);
      if (range.compareBoundaryPoints(Range.END_TO_START, nr) >= 0) continue;
      if (range.compareBoundaryPoints(Range.START_TO_END, nr) <= 0) continue;
      textNodes.push(n as Text);
    }
    const wrapped: HTMLSpanElement[] = [];
    for (const tn of textNodes) {
      let s = 0, e = tn.textContent!.length;
      if (tn === startC) s = startO;
      if (tn === endC) e = endO;
      if (s >= e) continue;
      let node: Text = tn;
      if (s > 0) { node = node.splitText(s) as Text; e -= s; }
      if (e < node.textContent!.length) node.splitText(e);
      const parent = node.parentNode as HTMLElement | null;
      if (parent && parent.tagName === 'SPAN' && parent.childNodes.length === 1 && parent.style?.fontSize && parent !== edBodyRef.current) {
        parent.style.fontSize = px + 'px';
        wrapped.push(parent as HTMLSpanElement);
      } else if (parent) {
        const span = document.createElement('span');
        span.style.fontSize = px + 'px';
        parent.insertBefore(span, node);
        span.appendChild(node);
        wrapped.push(span);
      }
    }
    wrapped.forEach(sp => {
      sp.querySelectorAll<HTMLElement>('[style*="font-size"]').forEach(el => { el.style.fontSize = ''; });
    });
    if (wrapped.length) {
      const r = document.createRange();
      r.setStartBefore(wrapped[0]);
      r.setEndAfter(wrapped[wrapped.length - 1]);
      sel.removeAllRanges(); sel.addRange(r);
      savedRangeRef.current = r.cloneRange();
    }
    markDirty();
  }, [restoreRange, markDirty]);

  /* Toolbar mousedown preservation ──────────────────────────────── */
  const preserveSelection = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) e.preventDefault();
  }, []);

  /* Stats strip data for the current entry — trade entries show that trade's
     stats, daily entries aggregate all trades from that dateISO, others none. */
  const stripStats = useMemo(() => {
    if (!currentEntry) return null;
    // Trade entry
    if (currentEntry.tradeId != null) {
      const t = trades.find(x => x.id === currentEntry.tradeId);
      if (!t) return null;
      const pnl = tradePnL(t) ?? 0;
      const isWin = t.result === 'WIN' || (t.result !== 'LOSS' && t.result !== 'BE' && pnl > 0);
      const isLoss = t.result === 'LOSS' || (t.result !== 'WIN' && t.result !== 'BE' && pnl < 0);
      return {
        kind: 'trade' as const,
        pnlNet: pnl,
        pnlGross: pnl,
        trades: 1,
        wins: isWin ? 1 : 0,
        losses: isLoss ? 1 : 0,
        wr: isWin ? 100 : isLoss ? 0 : 50,
        volume: t.contracts,
        pf: isWin ? Infinity : isLoss ? 0 : null,
        symbol: t.symbol,
        direction: t.direction,
      };
    }
    // Daily entry — aggregate the day
    if (currentEntry.folderId === 'daily' && currentEntry.dateISO) {
      const day = trades.filter(x => x.dateISO === currentEntry.dateISO && x.result !== 'OPEN');
      if (!day.length) return { kind: 'daily' as const, empty: true };
      let pnlGross = 0, wins = 0, losses = 0, winsPnl = 0, lossesPnl = 0, volume = 0;
      for (const t of day) {
        const p = tradePnL(t) ?? 0;
        pnlGross += p; volume += t.contracts;
        if (t.result === 'WIN') { wins++; winsPnl += Math.abs(p); }
        else if (t.result === 'LOSS') { losses++; lossesPnl += Math.abs(p); }
      }
      const decided = wins + losses;
      return {
        kind: 'daily' as const,
        pnlNet: pnlGross, pnlGross, trades: day.length, wins, losses,
        wr: decided ? Math.round((wins / decided) * 100) : 0,
        volume,
        pf: lossesPnl > 0 ? winsPnl / lossesPnl : (winsPnl > 0 ? Infinity : null),
      };
    }
    return null;
  }, [currentEntry, trades]);

  /* Templates: apply into editor body (replace content, autosave) */
  const applyTemplate = useCallback((tpl: NotebookTemplate) => {
    if (!currentEntry || !edBodyRef.current) return;
    edBodyRef.current.innerHTML = tpl.html;
    patchEntry(currentEntry.id, { bodyHtml: tpl.html });
    setAutosaveVisible(true);
    setTimeout(() => setAutosaveVisible(false), 1600);
  }, [currentEntry, patchEntry]);

  /* Templates: add/remove custom ones */
  const persistCustomTemplates = useCallback((next: (NotebookTemplate & { updatedAt?: number; deleted?: boolean })[]) => {
    setCustomTemplates(next);
    void commitList<NotebookTemplate & { updatedAt?: number; deleted?: boolean }>(TEMPLATES_KIND, TEMPLATES_KEY, next);
  }, []);
  const addCustomTemplate = useCallback(() => {
    if (!currentEntry || !edBodyRef.current) return;
    setTemplateNameModal({ name: '' });
  }, [currentEntry]);
  const confirmAddTemplate = useCallback((name: string) => {
    if (!currentEntry || !edBodyRef.current || !name.trim()) return;
    const tpl: NotebookTemplate & { updatedAt?: number } = {
      id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      html: edBodyRef.current.innerHTML,
      updatedAt: Date.now(),
    };
    persistCustomTemplates([...customTemplates, tpl]);
    setTemplateNameModal(null);
  }, [currentEntry, customTemplates, persistCustomTemplates]);
  const removeCustomTemplate = useCallback((id: string) => {
    persistCustomTemplates(customTemplates.filter(t => t.id !== id));
  }, [customTemplates, persistCustomTemplates]);

  /* Format signed dollars for the strip */
  const fmtMoney = (n: number) => (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 });

  /* Tag actions ──────────────────────────────────────────────────── */
  const openAddTag = useCallback(() => {
    setTagModal({ name: '', emoji: '🏷', swatch: 'f-gold', pickerTab: 'frequent', pickerSearch: '' });
  }, []);
  const removeTag = useCallback((idx: number) => {
    if (!currentEntry) return;
    const next = currentEntry.tags.filter((_, i) => i !== idx);
    patchEntry(currentEntry.id, { tags: next });
  }, [currentEntry, patchEntry]);
  const addTag = useCallback((name: string) => {
    if (!currentEntry || !name.trim()) return;
    patchEntry(currentEntry.id, { tags: [...currentEntry.tags, name.trim()] });
  }, [currentEntry, patchEntry]);

  /* Formatters for entry sub-row ─────────────────────────────────── */
  const formatEntrySub = (e: NotebookEntry): { pnl?: string; pnlCls?: 'win' | 'loss'; meta?: string; date?: string } => {
    if (e.tradeId != null) {
      const t = trades.find(x => x.id === e.tradeId);
      if (t) {
        const pnl = tradePnL(t) ?? 0;
        return {
          pnl: (pnl >= 0 ? '+$' : '-$') + Math.abs(pnl).toLocaleString('en-US', { maximumFractionDigits: 2 }),
          pnlCls: pnl >= 0 ? 'win' : 'loss',
          meta: `${t.symbol} · ${t.direction === 'LONG' ? 'לונג' : 'שורט'} · ${t.contracts} חוזים`,
          date: e.dateISO,
        };
      }
    }
    return { meta: e.dateISO };
  };

  /* Render ══════════════════════════════════════════════════════════ */
  return (
    <div className="nb-app">
      <div className="nb-shell">
        {/* Topbar */}
        <div className="nb-topbar">
          <div className="nb-brand"><span className="nb-brand-dot" /><span className="nb-brand-name">Onyx</span></div>
          <span className="nb-breadcrumb"><b>מחברת</b></span>
          <div className="nb-top-spacer" />
          <div className="nb-ai-status" title="ה־AI Coach קורא את התוכן שאתה כותב כאן — טריידים, סיכומי יום, הערות אישיות — ומשלב אותו בתובנות שמופיעות בעמוד הראשי.">
            <span className="nb-ai-orb" />
            <span className="nb-ai-status-txt">AI COACH · לומד מהתוכן</span>
          </div>
          <div className="nb-top-search">
            <span className="ic">🔍</span>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש רשומות ותוכן..." />
          </div>
        </div>

        {/* Body */}
        <div className="nb-body">
          {/* Folders column */}
          <div className="nb-col">
            <div className="nb-folders-head">
              <button className="nb-add-folder-btn" onClick={() => setFolderModal({ name: '', emoji: '📁', swatch: 'f-gold', pickerTab: 'frequent', pickerSearch: '' })}>
                + הוסף תיקייה
              </button>
            </div>
            <div className="nb-col-scroll">
              <div className="nb-folder-section">
                <div className="nb-folder-section-title"><span>תיקיות</span><span>▾</span></div>
                {folders.map(f => {
                  const count = (entriesByFolder.get(f.id) ?? []).length;
                  const isActive = !filterTag && f.id === currentFolderId;
                  return (
                    <div key={f.id} className={`nb-folder ${f.swatch} ${isActive ? 'active' : ''} ${f.synced ? 'is-synced' : ''}`}
                      onClick={() => { setFilterTag(null); if (f.id !== currentFolderId) { setCurrentFolderId(f.id); setCurrentEntryId(null); } }}
                      title={f.builtin ? 'תיקייה מובנית — לא ניתן למחוק' : undefined}>
                      <span className="nb-folder-swatch" />
                      <span className="nb-folder-icon">{f.icon}</span>
                      <span className="nb-folder-name">{f.name}</span>
                      <span className="nb-folder-count">{count}</span>
                      {!f.builtin && (
                        <button className="nb-row-x" title="מחק תיקייה" onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDlg({
                            title: 'למחוק את התיקייה?',
                            msg: `התיקייה <b>${f.icon} ${f.name}</b> וכל <b>${count} הרשומות</b> שבתוכה יימחקו.`,
                            note: 'פעולה זו אינה ניתנת לשחזור.',
                            onConfirm: () => removeFolder(f.id),
                          });
                        }}>×</button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="nb-folder-section">
                <div className="nb-folder-section-title"><span>תגיות</span><span>▾</span></div>
                <div className="nb-tags-list">
                  {allTagsWithCounts.map(t => {
                    const isDefault = DEFAULT_TAGS.some(d => d.name === t.name);
                    return (
                      <div key={t.name} className={`nb-tag-pill ${t.cls} ${filterTag === t.name ? 'active' : ''}`}
                        onClick={() => setFilterTag(filterTag === t.name ? null : t.name)}
                        title={isDefault ? 'תגית מובנית — לא ניתן למחוק' : undefined}>
                        <span>{t.name}</span>
                        <span className="nb-tag-count">{t.count}</span>
                        {!isDefault && (
                          <button className="nb-row-x" title="הסר תגית מכל הרשומות" onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDlg({
                              title: 'להסיר את התגית מכל הרשומות?',
                              msg: `התגית <b>${t.name}</b> תוסר מכל <b>${t.count} הרשומות</b> שסומנו בה.`,
                              note: 'התוכן של הרשומות עצמן לא ייפגע — רק התגית תיעלם.',
                              onConfirm: () => {
                                const next = entries.map(en => en.tags.includes(t.name) ? { ...en, tags: en.tags.filter(x => x !== t.name), updatedAt: Date.now() } : en);
                                persistEntries(next);
                                if (filterTag === t.name) setFilterTag(null);
                              },
                            });
                          }}>×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Entries column */}
          <div className="nb-col">
            <div className="nb-entries-head">
              <div className="nb-entries-head-row">
                <span className="nb-entries-title"><span className="ico">📄</span><span>{filterTag ? `תגית: ${filterTag}` : currentFolder.name}</span></span>
                <div className="nb-entries-actions">
                  <button className="nb-entries-btn primary" title="רשומה חדשה" onClick={() => createEntry(currentFolderId)}>+</button>
                </div>
              </div>
              <div className={`nb-sync-banner ${currentFolder.synced ? 'on' : ''}`}>
                <span className="nb-s-orb" />
                <span>מסונכרן אוטומטית מיומן העסקאות · <b>ה־AI קורא כל הערה</b></span>
              </div>
            </div>
            <div className="nb-col-scroll">
              {filteredEntries.length === 0 ? (
                <div className="nb-entries-empty">אין רשומות בתיקייה זו עדיין.<br />לחץ <b style={{ color: 'var(--nb-gold)' }}>+</b> להוסיף רשומה חדשה.</div>
              ) : filteredEntries.map(e => {
                // Hide entries that are truly empty (no title AND no body AND not a trade-linked auto-entry)
                // unless it's the one the user is currently editing — otherwise clicking + would leave
                // "(ללא כותרת)" ghosts in the list.
                if (currentEntry?.id !== e.id && !e.title.trim() && !e.bodyHtml.trim() && e.tradeId == null) return null;
                const sub = formatEntrySub(e);
                const isActive = currentEntry?.id === e.id;
                return (
                  <div key={e.id} className={`nb-entry ${isActive ? 'active' : ''}`} onClick={() => setCurrentEntryId(e.id)}>
                    <button className="nb-row-x" title="מחק רשומה" onClick={(ev) => {
                      ev.stopPropagation();
                      setConfirmDlg({
                        title: 'למחוק את הרשומה?',
                        msg: `הרשומה <b>${e.title || 'ללא כותרת'}</b> תימחק לצמיתות, כולל כל התוכן שכתבת בה.`,
                        note: 'פעולה זו אינה ניתנת לשחזור.',
                        onConfirm: () => removeEntry(e.id),
                      });
                    }}>×</button>
                    <div className="nb-entry-title">{e.title || '(ללא כותרת)'}</div>
                    <div className="nb-entry-sub">
                      {sub.date && <span>{sub.date}</span>}
                      {sub.pnl && <><span className="dot" /><span style={{ color: sub.pnlCls === 'win' ? 'var(--nb-bull)' : 'var(--nb-bear)', fontWeight: 800 }}>{sub.pnl}</span></>}
                      {sub.meta && (sub.pnl || sub.date) && <span className="dot" />}
                      {sub.meta && <span>{sub.meta}</span>}
                    </div>
                    {e.tags.length > 0 && (
                      <div className="nb-entry-tags">
                        {e.tags.map((t, i) => <span key={i} className={`nb-entry-tag ${tagClass(t)}`}>{t}</span>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Editor column */}
          <div className="nb-editor" onMouseDown={preserveSelection}>
            {!currentEntry ? (
              <div className="nb-entries-empty" style={{ margin: 'auto' }}>בחר רשומה מהרשימה או צור חדשה</div>
            ) : (
              <>
                <div className="nb-ed-header">
                  <div className="nb-ed-title-wrap">
                    <div className="nb-ed-cal-ico">📅</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input className="nb-ed-title-edit"
                        value={currentEntry.title}
                        placeholder="כותרת הרשומה..."
                        onChange={e => patchEntry(currentEntry.id, { title: e.target.value })} />
                      <div className="nb-ed-subtitle">{(() => {
                        const sub = formatEntrySub(currentEntry);
                        // When the stats strip is showing, the P&L is already prominent there — don't duplicate it in the subtitle.
                        const parts = stripStats ? [sub.date, sub.meta] : [sub.date, sub.pnl, sub.meta];
                        return parts.filter(Boolean).join(' · ') || 'רשומה חדשה';
                      })()}</div>
                    </div>
                  </div>
                  <div className="nb-ed-head-right">
                    <div className="nb-ed-meta">עודכן: {new Date(currentEntry.updatedAt ?? currentEntry.createdAt).toLocaleDateString('he-IL')}</div>
                    <button
                      type="button"
                      className={`nb-save-btn${dirty ? ' dirty' : ''}`}
                      onClick={saveNow}
                      title="שמירה (Ctrl+S)"
                    >
                      {dirty && <span className="nb-save-dot" />}
                      {dirty ? 'שמור שינויים' : 'נשמר'}
                    </button>
                  </div>
                </div>

                {/* Stats strip — visible for trade + daily entries */}
                {stripStats && !('empty' in stripStats && stripStats.empty) && (
                  <div className="nb-ed-strip">
                    <div className="nb-ed-net-block">
                      <span className="nb-ed-net-k">P&amp;L נטו</span>
                      <span className={`nb-ed-net-v ${stripStats.pnlNet! > 0 ? '' : stripStats.pnlNet! < 0 ? 'loss' : 'flat'}`}>{stripStats.pnlNet === 0 ? '—' : fmtMoney(stripStats.pnlNet!)}</span>
                      <span className="nb-ed-strip-meta">
                        {stripStats.kind === 'trade' ? `${stripStats.symbol} · ${stripStats.direction === 'LONG' ? 'לונג' : 'שורט'} · ${stripStats.volume} חוזים` : `${stripStats.trades} עסקאות · ${stripStats.volume} חוזים`}
                      </span>
                      {/* Mini chart — arrow up for win, down for loss */}
                      <svg className="nb-ed-mini-chart" viewBox="0 0 200 26" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id="nb-strip-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor={stripStats.pnlNet! >= 0 ? '#5fd39e' : '#f0899e'} stopOpacity=".35" />
                            <stop offset="1" stopColor={stripStats.pnlNet! >= 0 ? '#5fd39e' : '#f0899e'} stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        {stripStats.pnlNet! >= 0 ? (
                          <>
                            <path d="M0,22 L40,20 L80,16 L120,12 L160,7 L200,3 L200,26 L0,26 Z" fill="url(#nb-strip-grad)" />
                            <path d="M0,22 L40,20 L80,16 L120,12 L160,7 L200,3" fill="none" stroke="#5fd39e" strokeWidth="1.8" strokeLinecap="round" />
                            <circle cx="200" cy="3" r="2.5" fill="#5fd39e" />
                          </>
                        ) : (
                          <>
                            <path d="M0,3 L40,7 L80,12 L120,16 L160,20 L200,22 L200,26 L0,26 Z" fill="url(#nb-strip-grad)" />
                            <path d="M0,3 L40,7 L80,12 L120,16 L160,20 L200,22" fill="none" stroke="#f0899e" strokeWidth="1.8" strokeLinecap="round" />
                            <circle cx="200" cy="22" r="2.5" fill="#f0899e" />
                          </>
                        )}
                      </svg>
                    </div>
                    <div className="nb-ed-stats-grid">
                      <div className="nb-ed-stat"><span className="nb-ed-stat-k">סה&quot;כ עסקאות</span><span className="nb-ed-stat-v">{stripStats.trades}</span></div>
                      <div className="nb-ed-stat"><span className="nb-ed-stat-k">מנצחות</span><span className="nb-ed-stat-v bull">{stripStats.wins}</span></div>
                      <div className="nb-ed-stat"><span className="nb-ed-stat-k">מפסידות</span><span className="nb-ed-stat-v bear">{stripStats.losses}</span></div>
                      <div className="nb-ed-stat"><span className="nb-ed-stat-k">Win rate</span><span className="nb-ed-stat-v gold">{stripStats.wr}%</span></div>
                      <div className="nb-ed-stat"><span className="nb-ed-stat-k">P&amp;L ברוטו</span><span className={`nb-ed-stat-v ${(stripStats.pnlGross ?? 0) > 0 ? 'bull' : (stripStats.pnlGross ?? 0) < 0 ? 'bear' : ''}`}>{stripStats.pnlGross === 0 ? '—' : fmtMoney(stripStats.pnlGross ?? 0)}</span></div>
                      <div className="nb-ed-stat"><span className="nb-ed-stat-k">Profit factor</span><span className="nb-ed-stat-v gold">{stripStats.pf == null ? '—' : stripStats.pf === Infinity ? '∞' : stripStats.pf.toFixed(2)}</span></div>
                    </div>
                  </div>
                )}
                {stripStats && 'empty' in stripStats && stripStats.empty && (
                  <div className="nb-ed-strip" style={{ display: 'flex', justifyContent: 'center', padding: '14px 22px' }}>
                    <span className="nb-ed-strip-meta">אין עסקאות ליום זה — הרשומה עדיין תישמר ותהיה נגישה ל־AI Coach</span>
                  </div>
                )}

                {/* Tag row */}
                <div className="nb-ed-tagbar">
                  <span className="nb-ed-tagbar-ico">🏷</span>
                  {currentEntry.tags.map((t, i) => (
                    <span key={i} className={`nb-ed-tag ${tagClass(t)}`}>
                      {t}
                      <span className="nb-pill-x" title="הסר" onClick={() => setConfirmDlg({
                        title: 'להסיר את התגית?',
                        msg: `התגית <b>${t}</b> תוסר מהרשומה הזו.`,
                        note: 'ניתן להוסיף אותה שוב בכל רגע.',
                        onConfirm: () => removeTag(i),
                      })}>×</span>
                    </span>
                  ))}
                  <span className="nb-ed-tag-add" onClick={openAddTag}>+ הוסף תגית</span>
                </div>

                {/* Templates row */}
                <div className="nb-ed-templates">
                  <span className="nb-ed-templates-k">תבניות:</span>
                  {allTemplates.map(tpl => (
                    <span key={tpl.id} className="nb-ed-tpl" onClick={() => applyTemplate(tpl)}>
                      <span>{tpl.name}</span>
                      {!tpl.builtin && (
                        <span className="nb-pill-x" title="הסר תבנית" onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDlg({
                            title: 'למחוק את התבנית?',
                            msg: `התבנית <b>${tpl.name}</b> תוסר מהרשימה.`,
                            note: 'התוכן שכבר הכנסת לרשומות לא ייפגע.',
                            onConfirm: () => removeCustomTemplate(tpl.id),
                          });
                        }}>×</span>
                      )}
                    </span>
                  ))}
                  <span className="nb-ed-tpl nb-ed-tpl-add" onClick={addCustomTemplate}>+ הוסף תבנית</span>
                </div>

                {/* Toolbar */}
                <div className="nb-ed-toolbar">
                  <button className="nb-tb-btn" title="בטל" onClick={() => exec('undo')}>↺</button>
                  <button className="nb-tb-btn" title="בצע מחדש" onClick={() => exec('redo')}>↻</button>
                  <div className="nb-tb-sep" />
                  <select className="nb-tb-sel" defaultValue="Heebo" onMouseDown={saveRange} onChange={e => exec('fontName', e.target.value)}>
                    <option value="Heebo">Heebo</option>
                    <option value="Frank Ruhl Libre">Frank Ruhl Libre</option>
                    <option value="Arial">Arial</option>
                    <option value="Georgia">Georgia</option>
                    <option value="ui-monospace">Monospace</option>
                  </select>
                  <SizeControl onApply={applySize} onSave={saveRange} />
                  <div className="nb-tb-sep" />
                  <button className="nb-tb-btn" title="מודגש" style={{ fontWeight: 900 }} onClick={() => exec('bold')}>B</button>
                  <button className="nb-tb-btn" title="נטוי" style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }} onClick={() => exec('italic')}>I</button>
                  <button className="nb-tb-btn" title="קו תחתון" style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }} onClick={() => exec('underline')}>U</button>
                  <button className="nb-tb-btn" title="קו חוצה" style={{ textDecoration: 'line-through' }} onClick={() => exec('strikeThrough')}>S</button>
                  <div className="nb-tb-sep" />
                  <button className="nb-tb-btn nb-tb-color" title="צבע טקסט"
                    onClick={(e) => { const r = (e.target as HTMLElement).closest('button')!.getBoundingClientRect(); saveRange(); setColorPop({ x: r.left, y: r.bottom + 8, kind: 'color' }); }}>
                    <span className="nb-tb-a">A</span><span className="nb-tb-stripe" />
                  </button>
                  <button className="nb-tb-btn nb-tb-color" title="הדגשה"
                    onClick={(e) => { const r = (e.target as HTMLElement).closest('button')!.getBoundingClientRect(); saveRange(); setColorPop({ x: r.left, y: r.bottom + 8, kind: 'highlight' }); }}>
                    <span className="nb-tb-a" style={{ background: 'var(--nb-gold-15)', padding: '1px 4px', borderRadius: '3px' }}>Aa</span>
                  </button>
                  <div className="nb-tb-sep" />
                  <button className="nb-tb-btn" title="רשימה" onClick={() => exec('insertUnorderedList')}>•</button>
                  <button className="nb-tb-btn" title="רשימה ממוספרת" onClick={() => exec('insertOrderedList')}>1.</button>
                  <div className="nb-tb-sep" />
                  <button className="nb-tb-btn" title="קוד" onClick={() => exec('formatBlock', 'pre')}>&lt;/&gt;</button>
                  <button className="nb-tb-btn" title="ציטוט" onClick={() => exec('formatBlock', 'blockquote')}>❝</button>
                </div>

                {/* Editor body */}
                <div className="nb-ed-body"
                  ref={edBodyRef}
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="התחל לכתוב..."
                  onInput={markDirty}
                  onMouseUp={saveRange}
                  onKeyUp={saveRange} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Autosave chip */}
      <div className={`nb-autosave${autosaveVisible ? ' show' : ''}`}><span className="nb-autosave-dot" />נשמר</div>

      {/* Folder create modal */}
      {folderModal && (
        <FolderCreateModal
          state={folderModal}
          setState={setFolderModal}
          onCancel={() => setFolderModal(null)}
          onConfirm={({ name, emoji, swatch }) => {
            const sortOrder = Math.max(...folders.map(f => f.sortOrder ?? 0), 0) + 1;
            const created = newFolder(name, emoji, swatch, sortOrder);
            persistCustomFolders([...customFolders, created]);
            setCurrentFolderId(created.id);
            setFolderModal(null);
          }}
        />
      )}

      {/* Tag create modal — same modal, different context */}
      {tagModal && (
        <FolderCreateModal
          title="תגית חדשה"
          nameLabel="שם התגית"
          namePlaceholder="לדוגמה: A+ Setup"
          confirmLabel="צור תגית"
          swatchLabel="צבע התגית"
          state={tagModal}
          setState={setTagModal}
          onCancel={() => setTagModal(null)}
          onConfirm={({ name, emoji }) => {
            const label = emoji === '🏷' ? name : `${emoji} ${name}`;
            addTag(label);
            setTagModal(null);
          }}
        />
      )}

      {/* Confirm dialog */}
      {confirmDlg && (
        <div className="nb-modal-overlay on" onClick={(e) => { if (e.target === e.currentTarget) setConfirmDlg(null); }}>
          <div className="nb-modal nb-confirm" role="alertdialog">
            <div className="nb-modal-head nb-confirm-head">
              <div className="nb-confirm-icon">⚠</div>
              <div className="nb-confirm-title">{confirmDlg.title}</div>
            </div>
            <div className="nb-confirm-body">
              <div className="nb-confirm-msg" dangerouslySetInnerHTML={{ __html: confirmDlg.msg }} />
              {confirmDlg.note && <div className="nb-confirm-note">{confirmDlg.note}</div>}
            </div>
            <div className="nb-modal-foot">
              <button className="nb-modal-btn ghost" onClick={() => setConfirmDlg(null)}>ביטול</button>
              <button className="nb-modal-btn danger" onClick={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}>אשר</button>
            </div>
          </div>
        </div>
      )}

      {/* Color palette popover */}
      {colorPop && (
        <ColorPalette
          x={colorPop.x} y={colorPop.y} kind={colorPop.kind}
          onClose={() => setColorPop(null)}
          onPick={(hex) => {
            if (colorPop.kind === 'color') {
              exec('foreColor', hex);
            } else {
              const cmd = (typeof document !== 'undefined' && document.queryCommandSupported && document.queryCommandSupported('hiliteColor')) ? 'hiliteColor' : 'backColor';
              exec(cmd, hex);
            }
            setColorPop(null);
          }}
          onClear={() => { exec('removeFormat'); setColorPop(null); }}
        />
      )}

      {/* Template-name modal — proper UI instead of window.prompt */}
      {templateNameModal && (
        <div className="nb-modal-overlay on" onClick={(e) => { if (e.target === e.currentTarget) setTemplateNameModal(null); }}>
          <div className="nb-modal" role="dialog" aria-modal="true" style={{ maxWidth: 400 }}>
            <div className="nb-modal-head">
              <div className="nb-modal-title">שמור כתבנית</div>
              <button className="nb-modal-close" onClick={() => setTemplateNameModal(null)}>✕</button>
            </div>
            <div className="nb-modal-body">
              <div>
                <div className="nb-modal-label">שם התבנית</div>
                <input className="nb-modal-input" autoFocus placeholder="לדוגמה: תבנית סוף שבוע"
                  value={templateNameModal.name}
                  onChange={(e) => setTemplateNameModal({ name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && templateNameModal.name.trim()) confirmAddTemplate(templateNameModal.name);
                    if (e.key === 'Escape') setTemplateNameModal(null);
                  }} />
                <div style={{ fontFamily: 'var(--nb-ff-mono)', fontSize: 10, color: 'var(--nb-w40)', marginTop: 10, letterSpacing: '.05em' }}>
                  התוכן הנוכחי של העורך יישמר כתבנית שתוכל להחיל על רשומות עתידיות בלחיצה אחת.
                </div>
              </div>
            </div>
            <div className="nb-modal-foot">
              <button className="nb-modal-btn ghost" onClick={() => setTemplateNameModal(null)}>ביטול</button>
              <button className="nb-modal-btn primary" disabled={!templateNameModal.name.trim()} onClick={() => confirmAddTemplate(templateNameModal.name)}>שמור תבנית</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Sub-components
══════════════════════════════════════════════════════════════════ */

/** Size stepper — save selection on focus, apply on ± / enter. */
function SizeControl({ onApply, onSave }: { onApply: (px: number) => void; onSave: () => void }) {
  const [val, setVal] = useState(18);
  return (
    <div className="nb-tb-size-wrap">
      <button className="nb-tb-btn nb-tb-sq" onClick={() => { const n = Math.max(10, val - 1); setVal(n); onApply(n); }}>−</button>
      <input className="nb-tb-num" type="number" value={val} min={10} max={60}
        onFocus={onSave}
        onChange={(e) => setVal(parseInt(e.target.value, 10) || 18)}
        onBlur={() => onApply(val)}
        onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }} />
      <button className="nb-tb-btn nb-tb-sq" onClick={() => { const n = Math.min(60, val + 1); setVal(n); onApply(n); }}>+</button>
    </div>
  );
}

/** Folder / Tag create modal — reused for both with different labels. */
type FolderModalState = { name: string; emoji: string; swatch: FolderSwatch; pickerTab: string; pickerSearch: string };
function FolderCreateModal({
  state, setState, onCancel, onConfirm,
  title = 'תיקייה חדשה',
  nameLabel = 'שם התיקייה',
  namePlaceholder = 'לדוגמה: יומן פסיכולוגיה',
  confirmLabel = 'צור תיקייה',
  swatchLabel = 'צבע התיקייה',
}: {
  state: FolderModalState;
  setState: (s: FolderModalState) => void;
  onCancel: () => void;
  onConfirm: (result: { name: string; emoji: string; swatch: FolderSwatch }) => void;
  title?: string; nameLabel?: string; namePlaceholder?: string; confirmLabel?: string; swatchLabel?: string;
}) {
  const emojiList = state.pickerSearch.trim() ? Object.values(EMOJI).flat() : (EMOJI[state.pickerTab] ?? []);
  return (
    <div className="nb-modal-overlay on" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="nb-modal" role="dialog" aria-modal="true">
        <div className="nb-modal-head">
          <div className="nb-modal-title">{title}</div>
          <button className="nb-modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="nb-modal-body">
          <div>
            <div className="nb-modal-label">{nameLabel}</div>
            <div className="nb-modal-preview">
              <div className="nb-preview-emoji">{state.emoji}</div>
              <input className="nb-modal-input" autoFocus placeholder={namePlaceholder}
                value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter' && state.name.trim()) onConfirm({ name: state.name.trim(), emoji: state.emoji, swatch: state.swatch }); if (e.key === 'Escape') onCancel(); }} />
            </div>
          </div>
          <div>
            <div className="nb-modal-label">{swatchLabel}</div>
            <div className="nb-swatch-row">
              {(['f-gold','f-purple','f-green','f-blue','f-red',''] as FolderSwatch[]).map((sw, i) => {
                const name = sw === 'f-gold' ? 'gold' : sw === 'f-purple' ? 'purple' : sw === 'f-green' ? 'green' : sw === 'f-blue' ? 'blue' : sw === 'f-red' ? 'red' : 'gray';
                return <span key={i} className={`nb-swatch-opt ${name} ${state.swatch === sw ? 'active' : ''}`} onClick={() => setState({ ...state, swatch: sw })} />;
              })}
            </div>
          </div>
          <div>
            <div className="nb-modal-label">בחר אימוג׳י</div>
            <div className="nb-picker">
              <div className="nb-picker-search"><span className="ic">🔍</span><input placeholder="חיפוש..." value={state.pickerSearch} onChange={(e) => setState({ ...state, pickerSearch: e.target.value })} /></div>
              <div className="nb-picker-tabs">
                {EMOJI_TABS.map(t => (
                  <button key={t.key} className={`nb-picker-tab ${state.pickerTab === t.key ? 'active' : ''}`} title={t.name} onClick={() => setState({ ...state, pickerTab: t.key, pickerSearch: '' })}>{t.label}</button>
                ))}
              </div>
              <div className="nb-picker-grid">
                {emojiList.map((e, i) => <button key={i} className="nb-picker-emoji" onClick={() => setState({ ...state, emoji: e })}>{e}</button>)}
              </div>
            </div>
          </div>
        </div>
        <div className="nb-modal-foot">
          <button className="nb-modal-btn ghost" onClick={onCancel}>ביטול</button>
          <button className="nb-modal-btn primary" disabled={!state.name.trim()} onClick={() => onConfirm({ name: state.name.trim(), emoji: state.emoji, swatch: state.swatch })}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** Color palette popover. */
function ColorPalette({ x, y, kind, onClose, onPick, onClear }: { x: number; y: number; kind: 'color' | 'highlight'; onClose: () => void; onPick: (hex: string) => void; onClear: () => void }) {
  const popRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) onClose(); };
    setTimeout(() => document.addEventListener('click', onDoc), 0);
    return () => document.removeEventListener('click', onDoc);
  }, [onClose]);
  // Clamp within viewport
  let left = x, top = y;
  if (typeof window !== 'undefined') {
    if (left + 400 > window.innerWidth - 20) left = window.innerWidth - 400 - 20;
    if (top + 340 > window.innerHeight - 20) top = y - 340 - 16;
    left = Math.max(20, left);
  }
  return (
    <div ref={popRef} className="nb-color-pop on" style={{ top, left }} onMouseDown={(e) => e.preventDefault()}>
      <div className="nb-color-pop-head">
        <span className="nb-color-pop-title">{kind === 'color' ? 'צבע טקסט' : 'צבע הדגשה'}</span>
        <button className="nb-color-pop-close" onClick={onClose}>✕</button>
      </div>
      <div className="nb-color-pop-section">
        <div className="nb-color-pop-label">גוונים בשימוש</div>
        <div className="nb-color-neutrals">
          {NEUTRALS.map(c => <span key={c} className="nb-color-swatch" style={{ background: c }} title={c} onClick={() => onPick(c)} />)}
        </div>
      </div>
      <div className="nb-color-pop-section">
        <div className="nb-color-pop-label">פלטת צבעים</div>
        <div className="nb-color-grid">
          {TINTS.flatMap(t => HUES.map((h, i) => { const c = `hsl(${h.h}, ${h.s}%, ${t}%)`; return <span key={`${t}-${i}`} className="nb-color-swatch" style={{ background: c }} onClick={() => onPick(c)} />; }))}
        </div>
      </div>
      <div className="nb-color-pop-foot">
        <label className="nb-color-custom">
          <input type="color" defaultValue="#e6c665" onChange={(e) => onPick(e.target.value)} onMouseDown={(e) => e.stopPropagation()} />
          <span>מותאם</span>
        </label>
        <button className="nb-color-clear" onClick={onClear}>נקה עיצוב</button>
      </div>
    </div>
  );
}
