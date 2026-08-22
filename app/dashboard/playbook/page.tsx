'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadTrades } from '../../lib/journal';
import type { TradeEntry } from '../../lib/journal';
import { INSTRUMENT_KEYS, type InstrumentKey } from '../../lib/instruments';
import { type SessionKey, sessionLabel, activeSessions } from '../../lib/sessions';
import { hydrateList, saveList } from '../../lib/sync/collections';
import {
  DEFAULT_FILTER, DIRECTIONS, DIRECTION_HE, EMPTY_STATS, GRADES,
  PLAYBOOK_COLLECTION, PLAYBOOK_STORAGE_KEY, STATUSES, STATUS_HE,
  emptySetup, normalizeSetup, renameCost, statsBySetupName, visibleSetups,
  type ChecklistItem, type Grade, type Setup, type SetupDirection,
  type SetupFilter, type SetupStats, type SetupStatus, type SortKey,
} from '../../lib/playbook';
import './setups.css';

// ─────────────────────────────────────────────────────────────────────────────
// The setups page.
//
// Every number a card shows is computed from the trade log, never stored on the
// setup. A setup is the trader's own writing — name, conditions, checklist —
// and its performance is whatever the journal says it was. Storing a win rate
// on the setup would let the two disagree, and the stored one would win by
// virtue of being the one on screen.
// ─────────────────────────────────────────────────────────────────────────────

const D = '◈';

/** Confirm-in-place window for a destructive button. Long enough to read the
 *  second label, short enough that a stray click doesn't stay armed. */
const CONFIRM_MS = 3500;
const TOAST_MS = 2600;

const SORTS: { key: SortKey; label: string; ltr?: boolean }[] = [
  { key: 'grade',  label: 'דירוג' },
  { key: 'win',    label: 'WIN %', ltr: true },
  { key: 'r',      label: 'AVG R', ltr: true },
  { key: 'trades', label: 'עסקאות' },
];

const sessionHe = (k: SessionKey) => sessionLabel(k);

/** dd.MM — the card's "last trade" stamp. */
function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return m && d ? `${d}.${m}` : '—';
}

// ── Draft (the drawer's working copy) ────────────────────────────────────────

interface Draft {
  name: string;
  description: string;
  howItWorks: string;
  grade: Grade;
  assets: InstrumentKey[];
  direction: SetupDirection;
  sessions: SessionKey[];
  status: SetupStatus;
  tags: string;
  checklist: ChecklistItem[];
}

function draftFrom(s: Setup): Draft {
  return {
    name: s.name, description: s.description, howItWorks: s.howItWorks,
    grade: s.grade, assets: [...s.assets], direction: s.direction,
    sessions: [...s.sessions], status: s.status,
    tags: s.tags.join(', '),
    checklist: s.checklist.length ? s.checklist.map(c => ({ ...c })) : [{ text: '', required: true }],
  };
}

function blankDraft(): Draft {
  return {
    name: '', description: '', howItWorks: '', grade: 'B', assets: [],
    direction: 'BOTH', sessions: [], status: 'active', tags: '',
    checklist: [{ text: '', required: true }, { text: '', required: true }, { text: '', required: true }],
  };
}

// ── Small building blocks ────────────────────────────────────────────────────

function Segmented<T extends string>({ options, value, onChange, labelOf, ltr, tone }: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labelOf?: (v: T) => string;
  /** Isolate each label. `A+` unisolated renders as `+A`: the plus is a neutral
   *  character at the end of the run, so it takes the paragraph's RTL direction. */
  ltr?: boolean;
  /** Which fill the selected option takes. White is the design system's
   *  default; gold is only for the control the design marks that way. */
  tone?: 'white' | 'gold';
}) {
  return (
    <div className="su-seg" data-tone={tone}>
      {options.map(o => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)}>
          {ltr ? <span className="su-ltr">{labelOf ? labelOf(o) : o}</span> : (labelOf ? labelOf(o) : o)}
        </button>
      ))}
    </div>
  );
}

function ChipRow<T extends string>({ label, options, value, onSelect, labelOf, ltrOptions }: {
  label: string;
  options: readonly (T | 'all')[];
  value: T | 'all';
  onSelect: (v: T | 'all') => void;
  labelOf: (v: T | 'all') => string;
  ltrOptions?: boolean;
}) {
  return (
    <div className="su-filter-group">
      <span className="su-filter-label">{label}</span>
      <div className="su-chip-set">
        {options.map(o => (
          <button key={o} type="button" className="su-chip" aria-pressed={value === o} onClick={() => onSelect(o)}>
            {ltrOptions && o !== 'all' ? <span className="su-ltr">{labelOf(o)}</span> : labelOf(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

function SetupCard({ setup, stats, trashed, confirming, onUse, onEdit, onPin, onStatus, onDelete, onRestore }: {
  setup: Setup;
  stats: SetupStats;
  trashed: boolean;
  confirming: boolean;
  onUse: () => void;
  onEdit: () => void;
  onPin: () => void;
  onStatus: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  // Required conditions first. The card shows three of what may be ten, and the
  // three worth showing are the ones that gate the entry — otherwise the flag
  // set in the drawer would be a toggle nothing on screen ever reflects.
  const preview = [
    ...setup.checklist.filter(c => c.required),
    ...setup.checklist.filter(c => !c.required),
  ].slice(0, 3);

  const pinned = setup.pinned && !trashed;

  return (
    <article className="su-card" data-pinned={pinned} data-trashed={trashed}>
      <div className="su-card-rule" />

      <div className="su-card-head">
        <div>
          {pinned && (
            <div className="su-pinned-tag"><span style={{ fontSize: 8 }}>{D}</span><span>מוצמד</span></div>
          )}
          <h2 className="su-card-name">{setup.name || 'ללא שם'}</h2>
          {setup.description && <p className="su-card-summary">{setup.description}</p>}
        </div>
        <span className="su-grade su-ltr" data-grade={setup.grade} title={`דירוג ${setup.grade}`}>
          {setup.grade}
        </span>
      </div>

      {/* ONE asset chip, always, reading "ES / NQ" — not one chip per
          instrument. The instruments a setup trades are a single fact about it,
          and splitting them made a two-instrument setup look like it carried
          two separate tags. A setup saved before the field existed has no
          instrument on it, which is not "unknown" but "not narrowed to one". */}
      <div className="su-tags">
        <span className="su-tag su-ltr" data-kind="asset">
          {setup.assets.length > 0 ? setup.assets.join(' / ') : 'ALL'}
        </span>
        <span className="su-tag" data-dir={setup.direction}>{DIRECTION_HE[setup.direction]}</span>
        {setup.sessions.map(s => <span key={s} className="su-tag">{sessionHe(s)}</span>)}
        {setup.tags.map(t => <span key={t} className="su-tag su-ltr" data-kind="tag">{t}</span>)}
      </div>

      <div className="su-how">
        <div className="su-section-label">איך הסטאפ עובד</div>
        <p data-empty={!setup.howItWorks}>
          {setup.howItWorks || 'עוד לא נכתב הסבר לסטאפ הזה.'}
        </p>
      </div>

      {/* Four numbers, all of them from the journal. An em-dash where there is
          nothing to show — a setup with no trades yet has no win rate, and
          printing 0% would be a claim rather than a blank. */}
      <div className="su-metrics">
        <div className="su-metric">
          <div className="su-metric-label">עסקאות</div>
          <div className="su-metric-value" data-tone={stats.trades === 0 ? 'dim' : undefined}>{stats.trades}</div>
        </div>
        <div className="su-metric">
          <div className="su-metric-label">WIN</div>
          <div
            className="su-metric-value"
            data-tone={stats.winRate === null ? 'dim' : stats.winRate < 50 ? 'soft' : undefined}
          >
            {stats.winRate === null ? '—' : `${stats.winRate.toFixed(0)}%`}
          </div>
        </div>
        <div className="su-metric">
          <div className="su-metric-label">AVG R</div>
          <div
            className="su-metric-value"
            data-tone={stats.avgR === null ? 'dim' : stats.avgR >= 1 ? 'gold' : undefined}
          >
            {stats.avgR === null ? '—' : `${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(2)}R`}
          </div>
        </div>
        <div className="su-metric">
          <div className="su-metric-label">PNL</div>
          <div
            className="su-metric-value"
            data-tone={stats.trades === 0 ? 'dim' : stats.pnl > 0 ? 'gold' : stats.pnl < 0 ? 'short' : 'dim'}
          >
            {stats.trades === 0 ? '—' : money(stats.pnl)}
          </div>
        </div>
      </div>

      <div>
        <div className="su-check-head">
          <span className="su-section-label">צ׳קליסט כניסה</span>
          <span className="su-section-label">
            {setup.checklist.length ? `${setup.checklist.length} סעיפים` : 'ריק'}
          </span>
        </div>
        <div className="su-checklist">
          {preview.length > 0 ? preview.map((c, i) => (
            <div className="su-check-line" key={i} data-optional={!c.required}>
              <i title={c.required ? 'תנאי חובה' : 'תנאי רשות'}>{D}</i>
              <span>{c.text}</span>
            </div>
          )) : (
            <div className="su-check-line" data-optional="true">
              <i>{D}</i><span>עוד לא הוגדרו תנאי כניסה</span>
            </div>
          )}
        </div>
      </div>

      <div className="su-card-foot">
        {!trashed ? (
          <>
            <button type="button" className="su-btn su-btn-sm su-btn-ghost" onClick={onUse}>שימוש בסטאפ ←</button>
            <button type="button" className="su-btn su-btn-sm su-btn-subtle" onClick={onEdit}>עריכה</button>
          </>
        ) : (
          <button type="button" className="su-btn su-btn-sm su-btn-ghost" onClick={onRestore}>שחזור ↺</button>
        )}

        <button
          type="button"
          className="su-btn-del"
          data-armed={confirming}
          onClick={onDelete}
        >
          {trashed
            ? (confirming ? 'מחיקה לצמיתות' : 'מחיקה סופית')
            : (confirming ? 'לאשר מחיקה' : 'מחיקה')}
        </button>

        {!trashed && (
          <>
            <button type="button" className="su-status" data-status={setup.status} onClick={onStatus} title="החלפת סטטוס">
              {STATUS_HE[setup.status]}
            </button>
            <button type="button" className="su-pin" aria-pressed={setup.pinned} onClick={onPin}>
              <span style={{ fontSize: 9 }} aria-hidden>{D}</span>
              <span>{setup.pinned ? 'ביטול הצמדה' : 'הצמדה'}</span>
            </button>
          </>
        )}

        <span className="su-updated" title="העסקה האחרונה שנרשמה על הסטאפ">{shortDate(stats.lastTradeISO)}</span>
      </div>
    </article>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PlaybookPage() {
  const router = useRouter();

  /** The FULL store, tombstones included. The recycle bin is exactly the
   *  tombstones, so the page cannot work off the active-only list the rest of
   *  the app uses. */
  const [store, setStore] = useState<Setup[]>([]);
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [filter, setFilter] = useState<SetupFilter>(DEFAULT_FILTER);
  const [view, setView] = useState<'active' | 'trash'>('active');
  const [drawer, setDrawer] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);

  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawerRef    = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Paint from cache first, then reconcile with the cloud. hydrateList writes
    // the merged store (tombstones and all) back to localStorage, so reading it
    // afterwards is what makes the bin correct across devices.
    const readStore = (): Setup[] => {
      try {
        const raw = localStorage.getItem(PLAYBOOK_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed)
          ? parsed.map(normalizeSetup).filter((s): s is Setup => s !== null)
          : [];
      } catch { return []; }
    };

    setStore(readStore());
    setTrades(loadTrades());
    hydrateList<Setup>(PLAYBOOK_COLLECTION, PLAYBOOK_STORAGE_KEY)
      .then(() => setStore(readStore()))
      .catch(() => { /* keep the local copy */ });
  }, []);

  // Both timers are cleared on unmount. A pending setToast firing after the
  // page is gone is a React warning; a pending one firing after a NAVIGATION is
  // how a toast outlives the action that raised it.
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const flash = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const clearToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast(null);
  }, []);

  /** Persist the whole store — the active list AND the tombstones.
   *
   *  Deliberately `saveList` and not `commitList`: commitList derives
   *  tombstones by diffing an active-only list, which would re-tombstone every
   *  restore the moment it was made. This page owns the `deleted` flag, so it
   *  has to own the write too. */
  const persist = useCallback((next: Setup[]) => {
    setStore(next);
    void saveList<Setup>(PLAYBOOK_COLLECTION, PLAYBOOK_STORAGE_KEY, next);
  }, []);

  const patch = useCallback((id: string, fn: (s: Setup) => Setup) => {
    persist(store.map(s => (s.id === id ? { ...fn(s), updatedAt: Date.now() } : s)));
  }, [persist, store]);

  const stats = useMemo(() => statsBySetupName(trades), [trades]);

  const activeSetups = useMemo(() => store.filter(s => !s.deleted), [store]);
  const trashSetups  = useMemo(() => store.filter(s => s.deleted && !s.purged), [store]);

  const inTrash = view === 'trash';
  const source  = inTrash ? trashSetups : activeSetups;
  const list    = useMemo(() => visibleSetups(source, stats, filter), [source, stats, filter]);

  const pinnedCount = activeSetups.filter(s => s.pinned).length;
  const sourceEmpty = source.length === 0;

  /** Switching views resets everything transient: a half-armed delete must not
   *  survive into the other list, and a toast about the playbook must not still
   *  be sitting over the recycle bin. */
  function toggleView() {
    setView(v => (v === 'trash' ? 'active' : 'trash'));
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmId(null);
    clearToast();
  }

  // ── Drawer ────────────────────────────────────────────────────────────────

  function openNew() {
    setDraft(blankDraft());
    setEditingId(null);
    setNameError(false);
    setDrawer(true);
  }

  function openEdit(s: Setup) {
    setDraft(draftFrom(s));
    setEditingId(s.id);
    setNameError(false);
    setDrawer(true);
  }

  const closeDrawer = useCallback(() => { setDrawer(false); setEditingId(null); }, []);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', onKey);
    // Move focus into the panel so the keyboard follows the eye, and so Escape
    // reaches the handler above without a click first.
    drawerRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, closeDrawer]);

  function saveDraft() {
    const name = draft.name.trim();
    if (!name) {
      setNameError(true);
      flash('חסר שם לסטאפ');
      return;                       // the panel stays open
    }
    const checklist = draft.checklist
      .map(c => ({ text: c.text.trim(), required: c.required }))
      .filter(c => c.text !== '');
    const tags = draft.tags.split(',').map(t => t.trim()).filter(Boolean);

    const fields = {
      name, description: draft.description.trim(), howItWorks: draft.howItWorks.trim(),
      checklist, tags, grade: draft.grade, assets: draft.assets,
      direction: draft.direction, sessions: draft.sessions, status: draft.status,
    };

    if (editingId) {
      const before = store.find(s => s.id === editingId);
      // Spread onto the existing row, so `pinned` and every sync field survive
      // the edit — the drawer never carried them.
      persist(store.map(s => (s.id === editingId ? { ...s, ...fields, updatedAt: Date.now() } : s)));
      // Attribution is by name, so a rename detaches the history. Say the
      // number rather than letting them find the empty card afterwards.
      const detached = before && before.name.trim() !== name ? renameCost(stats, before.name) : 0;
      flash(detached > 0 ? `הסטאפ עודכן · ${detached} עסקאות עדיין רשומות על השם הקודם` : 'הסטאפ עודכן');
    } else {
      const created: Setup = { ...emptySetup(), ...fields, updatedAt: Date.now() };
      persist([created, ...store]);
      flash('הסטאפ נוסף לפלייבוק');
    }
    closeDrawer();
  }

  // ── Destructive actions ───────────────────────────────────────────────────

  function armOrRun(s: Setup, run: () => void) {
    if (confirmId === s.id) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      setConfirmId(null);
      run();
      return;
    }
    setConfirmId(s.id);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmId(null), CONFIRM_MS);
  }

  function handleDelete(s: Setup) {
    armOrRun(s, () => {
      if (inTrash) {
        // Purge keeps the tombstone. Dropping the row entirely would let a
        // device that never saw the delete resurrect it on the next merge.
        patch(s.id, x => ({ ...x, purged: true }));
        flash('הסטאפ נמחק לצמיתות');
      } else {
        patch(s.id, x => ({ ...x, deleted: true, pinned: false }));
        flash('הסטאפ הועבר לסל המחזור');
      }
    });
  }

  function handleRestore(s: Setup) {
    patch(s.id, x => ({ ...x, deleted: false, purged: false }));
    flash('הסטאפ שוחזר לפלייבוק');
  }

  function cycleStatus(s: Setup) {
    const next = STATUSES[(STATUSES.indexOf(s.status) + 1) % STATUSES.length];
    patch(s.id, x => ({ ...x, status: next }));
  }

  // ── Draft helpers ─────────────────────────────────────────────────────────

  const setD = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }));
  const toggleIn = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  function setCheck(i: number, next: Partial<ChecklistItem>) {
    setDraft(d => ({ ...d, checklist: d.checklist.map((c, j) => (j === i ? { ...c, ...next } : c)) }));
  }

  // ── Copy that changes with the view ───────────────────────────────────────

  const emptyTitle = !sourceEmpty
    ? 'אין תוצאות לסינון'
    : inTrash ? 'אין סטאפים שנמחקו' : 'הפלייבוק ריק';
  const emptyBody = !sourceEmpty
    ? 'נסה לשנות את החיפוש או להסיר פילטרים.'
    : inTrash
      ? 'כל סטאפ שתמחק יישמר כאן, ואפשר יהיה לשחזר אותו בלחיצה אחת.'
      : 'סטאפ הוא הכלל שאתה כותב לעצמך — שם, הסבר חופשי איך הוא עובד, וצ׳קליסט שמלווה אותך בכניסה.';

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="setups">
        <div className="su-glow su-glow-a" aria-hidden />
        <div className="su-glow su-glow-b" aria-hidden />

        <div className="su-wrap">
          <header className="su-head">
            <div className="su-head-text">
              {/* The diamond is a sibling, not part of the Latin run: inside the
                  isolated span it would be swept along with it and land after
                  the word. */}
              <div className="su-kicker">
                <span aria-hidden>{D}</span>
                <span className="su-ltr">{inTrash ? 'RECYCLE BIN' : 'PLAYBOOK'}</span>
              </div>
              <h1 className="su-title">{inTrash ? 'סל המחזור' : 'הסטאפים שלי'}</h1>
              <p className="su-lead">
                {inTrash
                  ? 'סטאפים שנמחקו נשמרים כאן. אפשר לשחזר אותם לפלייבוק או למחוק לצמיתות.'
                  : 'כל סטאפ הוא כלל שאתה כותב לעצמך — שם, תנאים, וצ׳קליסט כניסה. הביצועים מתעדכנים מתיעוד העסקאות.'}
              </p>
            </div>
            <div className="su-head-actions">
              <button
                type="button"
                className="su-btn-rail"
                data-on={inTrash}
                data-full={trashSetups.length > 0}
                onClick={toggleView}
              >
                {inTrash ? '← חזרה לפלייבוק' : `סל מחזור · ${trashSetups.length}`}
              </button>
              {/* No "new setup" inside the bin. */}
              {!inTrash && (
                <button type="button" className="su-btn su-btn-primary" onClick={openNew}>סטאפ חדש +</button>
              )}
            </div>
          </header>

          <div className="su-sweep-rail"><div className="su-sweep" /></div>

          <section className="su-filters">
            <div className="su-filters-rule" />
            <div className="su-filters-wash" aria-hidden />

            <div className="su-search-row">
              <div className="su-search">
                <span style={{ fontSize: 12, color: 'var(--gold-45)' }}>{D}</span>
                <input
                  value={filter.query}
                  onChange={e => setFilter(f => ({ ...f, query: e.target.value }))}
                  placeholder="חיפוש לפי שם, תגית או תנאי"
                  aria-label="חיפוש סטאפים"
                />
                <span className="su-mono su-ltr" style={{ fontSize: 10, letterSpacing: '0.22em', color: 'var(--white-30)' }}>SEARCH</span>
              </div>

              <div className="su-filter-group">
                <span className="su-filter-label" style={{ color: 'var(--gold-60)' }}>מיון</span>
                <div className="su-chip-frame">
                  {SORTS.map(s => (
                    <button
                      key={s.key}
                      type="button"
                      className="su-chip"
                      aria-pressed={filter.sort === s.key}
                      onClick={() => setFilter(f => ({ ...f, sort: s.key }))}
                    >
                      {s.ltr ? <span className="su-ltr">{s.label}</span> : s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="su-divider" />

            <div className="su-filter-row">
              <ChipRow<InstrumentKey>
                label="נכס"
                options={['all', ...INSTRUMENT_KEYS]}
                value={filter.asset}
                onSelect={v => setFilter(f => ({ ...f, asset: v }))}
                labelOf={v => (v === 'all' ? 'הכל' : v)}
                ltrOptions
              />
              <ChipRow<SessionKey>
                label="סשן"
                options={['all', ...activeSessions().map(s => s.key)]}
                value={filter.session}
                onSelect={v => setFilter(f => ({ ...f, session: v }))}
                labelOf={v => (v === 'all' ? 'הכל' : sessionHe(v))}
              />
              <ChipRow<SetupStatus>
                label="סטטוס"
                options={['all', ...STATUSES]}
                value={filter.status}
                onSelect={v => setFilter(f => ({ ...f, status: v }))}
                labelOf={v => (v === 'all' ? 'הכל' : STATUS_HE[v])}
              />
            </div>
          </section>

          <div className="su-count">
            <span>
              {inTrash
                ? `${list.length} סטאפים בסל המחזור`
                : `${list.length} סטאפים · ${pinnedCount} מוצמדים`}
            </span>
            <span className="su-count-hint">
              {inTrash ? 'שחזור מחזיר את הסטאפ עם כל ההיסטוריה' : 'הביצועים מחושבים מהעסקאות המשויכות'}
            </span>
          </div>

          {list.length > 0 ? (
            <section className="su-grid">
              {list.map(s => (
                <SetupCard
                  key={s.id}
                  setup={s}
                  stats={stats.get(s.name.trim()) ?? EMPTY_STATS}
                  trashed={inTrash}
                  confirming={confirmId === s.id}
                  onUse={() => router.push(`/dashboard/journal?setup=${encodeURIComponent(s.name)}`)}
                  onEdit={() => openEdit(s)}
                  onPin={() => patch(s.id, x => ({ ...x, pinned: !x.pinned }))}
                  onStatus={() => cycleStatus(s)}
                  onDelete={() => handleDelete(s)}
                  onRestore={() => handleRestore(s)}
                />
              ))}
            </section>
          ) : (
            <section className="su-empty">
              <div className="su-empty-glow" aria-hidden />
              <span style={{ fontSize: 26, color: 'var(--gold)', textShadow: '0 0 22px rgba(212,175,55,0.5)' }}>{D}</span>
              <h2>{emptyTitle}</h2>
              <p>{emptyBody}</p>
              {/* Only when the playbook itself is empty — never under "no
                  results for this filter", where the answer is to widen the
                  filter, not to write a setup. */}
              {!inTrash && sourceEmpty && (
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="su-btn su-btn-primary" onClick={openNew}>הגדרת סטאפ ראשון</button>
                </div>
              )}
            </section>
          )}
        </div>

        {drawer && (
          <>
            <button type="button" className="su-scrim" aria-label="סגירה" onClick={closeDrawer} />
            <aside
              className="su-drawer"
              ref={drawerRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label={editingId ? 'עריכת סטאפ' : 'סטאפ חדש'}
            >
              <div className="su-drawer-head">
                <div className="su-drawer-head-glow" aria-hidden />
                <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                  <div>
                    <div className="su-mono su-ltr" style={{ fontSize: 10, letterSpacing: '0.3em', color: 'var(--gold)' }}>
                      {editingId ? 'EDIT SETUP' : 'NEW SETUP'}
                    </div>
                    <h2 className="su-drawer-title">{editingId ? 'עריכת סטאפ' : 'סטאפ חדש'}</h2>
                  </div>
                  <button type="button" className="su-icon-btn" onClick={closeDrawer} aria-label="סגירה">×</button>
                </div>
              </div>

              <div className="su-drawer-body">
                <label>
                  <span className="su-field-label">שם הסטאפ</span>
                  <input
                    className="su-input"
                    value={draft.name}
                    onChange={e => { setD('name', e.target.value); if (nameError) setNameError(false); }}
                    placeholder="לדוגמה: סוויפ אסיה + CHoCH"
                    aria-invalid={nameError}
                  />
                  {/* The name is the join key to the journal — worth saying
                      once, in the one place where it is about to be chosen. */}
                  <span style={{ display: 'block', marginTop: 6, fontSize: 11, color: 'var(--white-30)' }}>
                    השם הוא מה שמקשר את הסטאפ לעסקאות ביומן.
                  </span>
                </label>

                <label>
                  <span className="su-field-label">תיאור קצר</span>
                  <input
                    className="su-input"
                    value={draft.description}
                    onChange={e => setD('description', e.target.value)}
                    placeholder="שורה אחת שמסבירה מתי הסטאפ רלוונטי"
                  />
                </label>

                <label>
                  <span className="su-field-label">איך הסטאפ עובד</span>
                  <textarea
                    className="su-textarea"
                    rows={6}
                    value={draft.howItWorks}
                    onChange={e => setD('howItWorks', e.target.value)}
                    placeholder="כתוב בחופשיות: מבנה, אזור עניין, טריגר כניסה, ניהול, יציאה."
                  />
                </label>

                {/* Asset and direction sit side by side. Asset stays
                    multi-select — a setup traded on both ES and NQ is one
                    setup, and the value has to match a trade's `symbol` to be
                    filterable — so it is a chip set wearing the segmented
                    control's frame rather than a single-choice control. */}
                <div className="su-pair">
                  <div>
                    <span className="su-field-label">נכס</span>
                    <div className="su-seg">
                      {INSTRUMENT_KEYS.map(k => (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={draft.assets.includes(k)}
                          onClick={() => setD('assets', toggleIn(draft.assets, k))}
                        >
                          <span className="su-ltr">{k}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="su-field-label">כיוון</span>
                    <Segmented
                      options={DIRECTIONS}
                      value={draft.direction}
                      onChange={v => setD('direction', v)}
                      labelOf={v => DIRECTION_HE[v]}
                    />
                  </div>
                </div>

                <div>
                  <span className="su-field-label">סשנים</span>
                  <div className="su-chip-set">
                    {activeSessions().map(s => (
                      <button
                        key={s.key}
                        type="button"
                        className="su-chip"
                        aria-pressed={draft.sessions.includes(s.key)}
                        onClick={() => setD('sessions', toggleIn(draft.sessions, s.key))}
                      >
                        {s.he}
                      </button>
                    ))}
                  </div>
                </div>

                <label>
                  <span className="su-field-label">תגיות</span>
                  <input
                    className="su-input su-ltr"
                    value={draft.tags}
                    onChange={e => setD('tags', e.target.value)}
                    placeholder="FVG, CHoCH, SWEEP"
                  />
                </label>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                    <span className="su-field-label" style={{ marginBottom: 0 }}>צ׳קליסט כניסה</span>
                    <button
                      type="button"
                      className="su-btn-add"
                      onClick={() => setD('checklist', [...draft.checklist, { text: '', required: true }])}
                    >
                      סעיף +
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {draft.checklist.map((c, i) => (
                      <div className="su-draft-check" key={i}>
                        <span style={{ color: 'var(--gold-45)', fontSize: 10 }}>{D}</span>
                        <input
                          className="su-input"
                          value={c.text}
                          onChange={e => setCheck(i, { text: e.target.value })}
                          placeholder="תנאי שחייב להתקיים לפני כניסה"
                        />
                        <button
                          type="button"
                          className="su-req"
                          aria-pressed={c.required}
                          title={c.required ? 'תנאי חובה' : 'תנאי רשות'}
                          onClick={() => setCheck(i, { required: !c.required })}
                        >
                          חובה
                        </button>
                        <button
                          type="button"
                          className="su-x"
                          aria-label="הסרת סעיף"
                          onClick={() => setD('checklist', draft.checklist.filter((_, j) => j !== i))}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                    <span className="su-field-label" style={{ marginBottom: 0 }}>דירוג</span>
                    <span style={{ fontSize: 11, color: 'var(--white-30)' }}>רמת הביטחון שאתה נותן לסטאפ</span>
                  </div>
                  <Segmented options={GRADES} value={draft.grade} onChange={v => setD('grade', v)} ltr tone="gold" />
                </div>

                <div>
                  <span className="su-field-label">סטטוס</span>
                  <Segmented
                    options={STATUSES}
                    value={draft.status}
                    onChange={v => setD('status', v)}
                    labelOf={v => STATUS_HE[v]}
                  />
                </div>
              </div>

              <div className="su-drawer-foot">
                <button type="button" className="su-btn su-btn-primary" onClick={saveDraft}>שמירת סטאפ</button>
                <button type="button" className="su-btn su-btn-subtle" onClick={closeDrawer}>ביטול</button>
                <span className="su-drawer-hint">
                  {editingId ? 'שינויים נשמרים לסטאפ הקיים' : 'אפשר לערוך הכל אחר כך'}
                </span>
              </div>
            </aside>
          </>
        )}

        {toast && (
          <div className="su-toast" role="status" aria-live="polite">
            <span style={{ color: 'var(--gold)', fontSize: 11 }}>{D}</span>
            <span className="su-toast-text">{toast}</span>
          </div>
        )}
      </div>
    </div>
  );
}
