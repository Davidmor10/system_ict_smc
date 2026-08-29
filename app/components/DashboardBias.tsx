'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BIAS_META, clearDeclaredBias, readDeclaredBias, writeBiasNote, writeDeclaredBias,
  type BiasChoice, type DeclaredBias,
} from '../lib/entryGate';
import { clockInZone } from '../lib/time/zone';
import { commitList } from '../lib/sync/collections';

/** Today's declared direction, and the reason behind it.
 *
 *  It used to live on the sign-in screen, which is the wrong place for it in
 *  one specific way: that screen is a doorway the trader passes through, and a
 *  decision made in a doorway is made without the day's numbers in front of
 *  it. Here it sits directly under the greeting and above the session row —
 *  the first thing on the surface the trader actually works from, and still
 *  before any of yesterday's figures can colour the call.
 *
 *  The reason is the part that makes the declaration worth keeping. A
 *  direction alone is a coin flip you can't grade later; "sweep of Asia's high
 *  into London" is a claim that tomorrow can be read back against what the
 *  market did. Optional, short, and saved separately from the direction so
 *  writing it an hour later does not restamp the moment the call was made.
 *
 *  NOTHING IS SAVED UNTIL SAVE IS PRESSED.
 *
 *  Pressing a direction used to write it immediately, and pressing the one
 *  already on did nothing at all — the code returned early where its own
 *  comment said it un-declared. So a mis-tap was permanent: the only way out
 *  of a direction was to pick a different one, which is a different answer
 *  from having no view.
 *
 *  The choice is a selection now, and the selection toggles. Save is what
 *  commits it, and the moment it commits is what gets stamped — which is the
 *  same mechanism that makes a change of mind at noon recordable as its own
 *  entry rather than as a correction of the morning. */
export default function DashboardBias() {
  const [declared, setDeclared] = useState<DeclaredBias | null>(null);
  /** What is selected on screen but not yet committed. `null` is a real
   *  value — it is the trader having cleared the selection. */
  const [choice, setChoice] = useState<BiasChoice | null>(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  /** Open while the direction is still a question, one line once it is
   *  answered. A control used once a morning should not hold a band of the
   *  screen for the rest of the day — but it must be unmissable until it has
   *  been used, which is why the undeclared state is never collapsed. */
  const [open, setOpen] = useState(true);
  const savedTimer = useRef<number | null>(null);

  useEffect(() => {
    const current = readDeclaredBias();
    setDeclared(current);
    setChoice(current?.bias ?? null);
    setNote(current?.note ?? '');
    // Collapsed on arrival when today's call was already made. Not collapsed
    // right after making it: the reason is usually typed in the same breath as
    // the direction, and closing the panel under the trader's hands would take
    // the field away mid-thought.
    if (current) setOpen(false);
  }, []);

  useEffect(() => () => { if (savedTimer.current) window.clearTimeout(savedTimer.current); }, []);

  /** Mirror the declaration to the account.
   *
   *  The plan has always been a localStorage record, which was fine while only
   *  this screen read it. The nightly note reads from the server, so a reason
   *  written here was invisible to the one reader with a use for it — it could
   *  compare what the trader expected against what they then did, and never
   *  saw the first half. One row per day, keyed by the date. */
  const syncPlan = useCallback((next: DeclaredBias) => {
    const today = new Date();
    const id = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    void commitList('dayplans', 'onyx_dayplans_v1', [
      { id, bias: next.bias, note: next.note, at: next.at ?? Date.now(), updatedAt: Date.now() },
    ]).catch(() => { /* best-effort — localStorage stays the source of truth */ });
  }, []);

  const flash = useCallback(() => {
    setSaved(true);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1400);
  }, []);

  /** Tapping the choice already selected clears it. Nothing is written here. */
  const pick = useCallback((next: BiasChoice) => {
    setChoice(cur => (cur === next ? null : next));
  }, []);

  const save = useCallback(() => {
    if (choice === null) {
      // Withdrawing the day's call. Not the same as 'neutral', which is a read.
      clearDeclaredBias();
      setDeclared(null);
      void commitList('dayplans', 'onyx_dayplans_v1', []).catch(() => {});
      flash();
      return;
    }
    const next = writeDeclaredBias(choice, note);
    setDeclared(next);
    syncPlan(next);
    flash();
  }, [choice, note, flash, syncPlan]);

  /** Nothing to save when the screen already matches what is stored. */
  const dirty = choice !== (declared?.bias ?? null);

  const commitNote = useCallback(() => {
    if (!declared) return;
    const trimmed = note.trim();
    if (trimmed === (declared.note ?? '')) return;
    writeBiasNote(trimmed);
    const next = { ...declared, note: trimmed };
    setDeclared(next);
    syncPlan(next);
    flash();
  }, [declared, note, flash, syncPlan]);

  const at = declared?.at ? new Date(declared.at) : null;
  const changes = declared?.history ?? [];
  const meta = declared ? BIAS_META[declared.bias] : null;
  const arrowFor = (key: BiasChoice) => (key === 'bull' ? '▲' : key === 'bear' ? '▼' : '—');

  // ── Collapsed: the answer, on one line ────────────────────────────────────
  if (declared && meta && !open) {
    return (
      <section className="dp-bias dp-bias-mini dp-rise" aria-label="ביאס היום">
        <button type="button" className="dp-bias-mini-btn" onClick={() => setOpen(true)}>
          <span className="dp-bias-k">ביאס היום</span>
          <span className="dp-bias-mini-v" style={{ color: meta.color }}>
            <span aria-hidden>{arrowFor(declared.bias)}</span> {meta.he}
          </span>
          {declared.note && <span className="dp-bias-mini-why">{declared.note}</span>}
          {at && <span className="dp-bias-at">{clockInZone(undefined, at)}</span>}
          {changes.length > 1 && (
            <span className="dp-bias-at">· {changes.length} שינויים היום</span>
          )}
          <span className="dp-bias-mini-cta">לשנות ←</span>
        </button>
      </section>
    );
  }

  return (
    <section className="dp-bias dp-rise" aria-label="ביאס היום">
      <div className="dp-bias-head">
        <span className="dp-bias-k">ביאס היום</span>
        {at && <span className="dp-bias-at">הוצהר {clockInZone(undefined, at)}</span>}
        <span className="dp-bias-saved" data-on={saved} aria-live="polite">נשמר ✓</span>
        {declared && (
          <button type="button" className="dp-bias-close" onClick={() => setOpen(false)}>סגור ✕</button>
        )}
      </div>

      <div className="dp-bias-picks" role="group">
        {(Object.keys(BIAS_META) as BiasChoice[]).map(key => {
          const meta = BIAS_META[key];
          const on = choice === key;
          return (
            <button
              key={key}
              type="button"
              className="dp-bias-pick"
              data-on={on}
              aria-pressed={on}
              onClick={() => pick(key)}
              style={on
                ? { color: meta.color, borderColor: meta.color, background: `color-mix(in srgb, ${meta.color} 12%, transparent)` }
                : undefined}
            >
              <span className="dp-bias-arrow" aria-hidden>{arrowFor(key)}</span>
              <span className="dp-bias-he">{meta.he}</span>
              <span className="dp-bias-en">{meta.en}</span>
            </button>
          );
        })}
      </div>

      {/* Save is the commit. Until it is pressed the panel is a selection and
          nothing downstream has changed — which is what makes a mis-tap
          recoverable and a change of mind at noon its own recorded entry. */}
      <div className="dp-bias-actions">
        <button
          type="button"
          className="dp-bias-save"
          onClick={save}
          disabled={!dirty}
        >
          {choice === null && declared ? 'הסר את ההצהרה' : 'שמור ביאס'}
        </button>
        {dirty && (
          <span className="dp-bias-dirty">
            {choice === null ? 'הסרת את הבחירה — שמור כדי לבטל את ההצהרה של היום' : 'נבחר, עדיין לא נשמר'}
          </span>
        )}
      </div>

      {/* Every change today, with the hour of each. A trade taken at ten was
          graded against the direction that stood at ten. */}
      {changes.length > 1 && (
        <div className="dp-bias-hist">
          <span className="dp-bias-hist-k">שינויים היום</span>
          <ol className="dp-bias-hist-list">
            {changes.map(e => (
              <li key={e.at}>
                <span className="dp-bias-hist-t" dir="ltr">{clockInZone(undefined, new Date(e.at))}</span>
                <span style={{ color: BIAS_META[e.bias].color }}>
                  <span aria-hidden>{arrowFor(e.bias)}</span> {BIAS_META[e.bias].he}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {declared ? (
        <label className="dp-bias-why">
          <span className="dp-bias-why-k">למה בחרת בכיוון הזה?</span>
          <input
            type="text"
            className="dp-bias-input"
            value={note}
            maxLength={160}
            placeholder="סוויפ של הגבוה של אסיה, FVG יומי שלא נסגר…"
            onChange={e => setNote(e.target.value)}
            onBlur={commitNote}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          />
        </label>
      ) : (
        <p className="dp-bias-empty">
          בלי כיוון מוצהר, אף עסקה של היום לא תיספר כמיושרת ולא כמנוגדת — וזו תשובה תקפה, לא חוסר.
        </p>
      )}

      <p className="dp-bias-note">
        כל עסקה שתתעד היום תסומן אוטומטית עם הכיוון או נגדו, כך שאפשר לחתוך את אחוזי ההצלחה לפי ההצהרה.
        ״חסר החלטה״ לא מסמן כלום. אפשר לשנות כיוון במהלך היום — כל שינוי נשמר עם השעה שלו.
      </p>
    </section>
  );
}
