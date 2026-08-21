'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  embedUrl, parseYouTubeRef, refKey, sameRef, searchUrl, watchUrl,
  type MusicItem, type MusicRef,
} from '../lib/music';
import './music.css';

// ─────────────────────────────────────────────────────────────────────────────
// MusicPanel — a small player in the corner of the workspace.
//
// It lives in the dashboard LAYOUT rather than on a page, and that is the whole
// design: a player mounted on a page unmounts the moment you walk from the
// journal to the notebook, and the music stops mid-bar. Here it survives every
// route change inside /dashboard.
//
// One input, two behaviours. Text that parses as a YouTube reference plays
// immediately; anything else is treated as a search. Search needs
// YOUTUBE_API_KEY on the server — when it is missing the route answers 501,
// the panel stops offering search for the session and hands over a YouTube
// link instead, so the panel is useful either way.
//
// State is deliberately device-local (localStorage, not the sync layer): what
// you are listening to on the desktop has no business following you to your
// phone, and this is the one preference in the app nobody wants merged.
// ─────────────────────────────────────────────────────────────────────────────

const STORE = 'onyx_music_v1';
const MAX_RECENTS = 6;

interface SearchRow { videoId: string; title: string; channel: string; thumb: string }
interface Stored { open?: boolean; current?: MusicRef | null; recents?: MusicItem[] }

/** A pasted link has no title until the player renders it, so the id stands in.
 *  Shortened, because a raw id in a 316px panel is noise. */
function fallbackLabel(ref: MusicRef): string {
  if (ref.videoId && ref.listId) return `${ref.videoId} · רשימה`;
  if (ref.videoId) return ref.videoId;
  return `רשימת השמעה · ${ref.listId ?? ''}`.trim();
}

function readStore(): Stored {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

export default function MusicPanel() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<MusicRef | null>(null);
  const [recents, setRecents] = useState<MusicItem[]>([]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  /** Flips to false the first time the route reports it has no key. */
  const [canSearch, setCanSearch] = useState(true);

  const inFlight = useRef<AbortController | null>(null);

  // Restore after mount, never during render: the server has no localStorage,
  // and reading it in the body would make the first client paint disagree with
  // the HTML that came down the wire.
  useEffect(() => {
    const s = readStore();
    if (s.open) setOpen(true);
    if (s.current) setCurrent(s.current);
    if (Array.isArray(s.recents)) setRecents(s.recents.slice(0, MAX_RECENTS));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORE, JSON.stringify({ open, current, recents }));
    } catch { /* a full or blocked store is not worth breaking playback over */ }
  }, [ready, open, current, recents]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const play = useCallback((ref: MusicRef, label?: string) => {
    if (!embedUrl(ref)) return;                 // refuse anything that will not frame
    setCurrent(ref);
    setNote('');
    setRecents(prev => {
      const entry: MusicItem = { ref, label: label || fallbackLabel(ref) };
      const rest = prev.filter(r => refKey(r.ref) !== refKey(ref));
      return [entry, ...rest].slice(0, MAX_RECENTS);
    });
  }, []);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = query.trim();
    if (!text) return;

    // A link plays. Everything else is a search.
    const ref = parseYouTubeRef(text);
    if (ref) {
      play(ref);
      setQuery('');
      setResults([]);
      return;
    }

    if (!canSearch) {
      setNote('no-key');
      return;
    }

    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setBusy(true);
    setNote('');

    try {
      const res = await fetch(`/api/music/search?q=${encodeURIComponent(text)}`, { signal: ctrl.signal });

      if (res.status === 501) {
        // No key on the server. Stop offering search rather than failing again
        // on every keystroke for the rest of the session.
        setCanSearch(false);
        setNote('no-key');
        return;
      }
      if (res.status === 429) { setNote('busy'); return; }
      if (!res.ok)            { setNote('failed'); return; }

      const data = (await res.json()) as { results?: SearchRow[] };
      const rows = data.results ?? [];
      setResults(rows);
      if (rows.length === 0) setNote('empty');
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setNote('failed');
    } finally {
      if (inFlight.current === ctrl) setBusy(false);
    }
  }, [query, canSearch, play]);

  // Nothing renders until the stored state is in hand — a panel that opens
  // closed and then pops open a frame later is worse than one that arrives a
  // tick late.
  if (!ready) return null;

  const src = current ? embedUrl(current) : null;
  const link = current ? watchUrl(current) : null;

  if (!open) {
    return (
      <div className="mu">
        <button type="button" className="mu-pill" onClick={() => setOpen(true)} aria-label="פתיחת נגן המוזיקה">
          <span className="mu-note" aria-hidden>♪</span>
          <span>מוזיקה</span>
          {current && <span className="mu-dot" aria-hidden />}
        </button>
      </div>
    );
  }

  return (
    <div className="mu">
      <section className="mu-panel" aria-label="נגן מוזיקה">
        <header className="mu-head">
          <span className="mu-title">
            <span className="mu-note" aria-hidden>♪</span>
            מוזיקה
          </span>
          <button type="button" className="mu-x" onClick={() => setOpen(false)} aria-label="מזעור הנגן">×</button>
        </header>

        <div className="mu-stage">
          {src ? (
            <iframe
              key={refKey(current!)}
              src={src}
              title="נגן יוטיוב"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <p className="mu-empty">הדבק לינק יוטיוב<br />או חפש שיר</p>
          )}
        </div>

        <form className="mu-form" onSubmit={submit}>
          <input
            className="mu-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={canSearch ? 'לינק יוטיוב או שם של שיר' : 'הדבק לינק יוטיוב'}
            aria-label="לינק יוטיוב או חיפוש"
            enterKeyHint="search"
          />
          <button type="submit" className="mu-go" disabled={busy || !query.trim()}>
            {busy ? '···' : 'נגן'}
          </button>
        </form>

        {note && (
          <p className="mu-hint">
            {note === 'no-key' && (
              <>
                חיפוש בתוך המערכת לא מוגדר.{' '}
                <a href={searchUrl(query)} target="_blank" rel="noreferrer noopener">לחפש ביוטיוב ↗</a>
                {' '}ולהדביק את הלינק כאן.
              </>
            )}
            {note === 'empty'  && 'לא נמצאו תוצאות.'}
            {note === 'busy'   && 'יותר מדי חיפושים. רגע ונסה שוב.'}
            {note === 'failed' && 'החיפוש נכשל. אפשר להדביק לינק ישירות.'}
          </p>
        )}

        {results.length > 0 && (
          <div className="mu-list">
            <p className="mu-list-l">תוצאות</p>
            {results.map(r => (
              <button
                key={r.videoId}
                type="button"
                className="mu-row"
                onClick={() => { play({ videoId: r.videoId }, r.title); setResults([]); setQuery(''); }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="mu-thumb" src={r.thumb} alt="" loading="lazy" />
                <span className="mu-row-t" title={r.title}>{r.title}</span>
              </button>
            ))}
          </div>
        )}

        {results.length === 0 && recents.length > 0 && (
          <div className="mu-list">
            <p className="mu-list-l">אחרונים</p>
            {recents.map(item => (
              <button
                key={refKey(item.ref)}
                type="button"
                className="mu-row"
                data-on={sameRef(item.ref, current)}
                onClick={() => play(item.ref, item.label)}
              >
                <span className="mu-row-t" title={item.label}>{item.label}</span>
                {sameRef(item.ref, current) && <span className="mu-row-s" aria-hidden>מתנגן</span>}
              </button>
            ))}
          </div>
        )}

        {(link || recents.length > 0) && (
          <div className="mu-foot">
            {link
              ? <a href={link} target="_blank" rel="noreferrer noopener">פתח ביוטיוב ↗</a>
              : <span />}
            {recents.length > 0 && (
              <button type="button" className="mu-clear" onClick={() => setRecents([])}>נקה אחרונים</button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
