'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BIAS_META, readDeclaredBias, writeBiasNote, writeDeclaredBias,
  type BiasChoice, type DeclaredBias,
} from '../lib/entryGate';
import { clockInZone } from '../lib/time/zone';

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
 *  writing it an hour later does not restamp the moment the call was made. */
export default function DashboardBias() {
  const [declared, setDeclared] = useState<DeclaredBias | null>(null);
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
    setNote(current?.note ?? '');
    // Collapsed on arrival when today's call was already made. Not collapsed
    // right after making it: the reason is usually typed in the same breath as
    // the direction, and closing the panel under the trader's hands would take
    // the field away mid-thought.
    if (current) setOpen(false);
  }, []);

  useEffect(() => () => { if (savedTimer.current) window.clearTimeout(savedTimer.current); }, []);

  const flash = useCallback(() => {
    setSaved(true);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1400);
  }, []);

  const pick = useCallback((choice: BiasChoice) => {
    // Tapping the choice already on is how a trader un-declares. Without it the
    // only way out of a direction is to pick a different one, which is not the
    // same answer as having no view.
    if (declared?.bias === choice) return;
    setDeclared(writeDeclaredBias(choice, note));
    flash();
  }, [declared, note, flash]);

  const commitNote = useCallback(() => {
    if (!declared) return;
    const trimmed = note.trim();
    if (trimmed === (declared.note ?? '')) return;
    writeBiasNote(trimmed);
    setDeclared({ ...declared, note: trimmed });
    flash();
  }, [declared, note, flash]);

  const at = declared?.at ? new Date(declared.at) : null;
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
          const on = declared?.bias === key;
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
        ״חסר החלטה״ לא מסמן כלום. נשמר לתאריך של היום בלבד.
      </p>
    </section>
  );
}
