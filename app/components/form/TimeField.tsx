'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The time field.
//
// Same reason as the date field: `<input type="time">` is drawn by the
// browser, in the browser's own light chrome, and no stylesheet reaches it.
//
// Two wheels rather than a keypad, because the hour is nearly always close to
// now — a trader logging a trade scrolls a few notches, they do not retype a
// number. Typing still works: the wheels are buttons and the keyboard walks
// them.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import './datetime.css';

/** Row height, in pixels, matching .dtf-tick in the stylesheet. Centring the
 *  chosen row on the band is `index * ITEM` — which holds only while the
 *  padding rows are half a column short of a row, and that is asserted in
 *  tests/lib/datetimeCss.test.ts rather than restated here. */
const ITEM = 32;

const pad2 = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** Which part of the day this is, in the words a person would use. Context
 *  under the number, so 03:40 reads as the night session at a glance. */
function partOfDay(h: number): string {
  if (h < 5) return 'לילה';
  if (h < 12) return 'בוקר';
  if (h < 17) return 'צהריים';
  if (h < 21) return 'ערב';
  return 'לילה';
}

function split(time: string): { h: number; m: number } {
  const hit = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!hit) return { h: 12, m: 0 };
  return {
    h: Math.min(23, Math.max(0, Number(hit[1]))),
    m: Math.min(59, Math.max(0, Number(hit[2]))),
  };
}

/** One column of the wheel. Owns its own scrolling: the parent tells it what
 *  is chosen, it reports back when the wheel settles somewhere else. */
function Wheel({
  values, value, onPick, label,
}: {
  values: number[]; value: number; onPick: (v: number) => void; label: string;
}) {
  const col = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Centre the chosen value when the panel opens. `auto`, not `smooth` — a
  // panel that animates its own contents into place on open looks broken.
  useEffect(() => {
    const el = col.current;
    if (!el) return;
    el.scrollTop = values.indexOf(value) * ITEM;
    // Deliberately on mount only: afterwards the wheel is where the trader
    // put it, and re-centring under them would fight the drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const el = col.current;
      if (!el) return;
      const i = Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / ITEM)));
      if (values[i] !== value) onPick(values[i]);
    }, 110);
  };

  const tap = (v: number) => {
    onPick(v);
    col.current?.scrollTo({ top: values.indexOf(v) * ITEM, behavior: 'smooth' });
  };

  return (
    <div>
      <div className="dtf-wheel-head">{label}</div>
      <div className="dtf-wheel" ref={col} onScroll={onScroll} role="listbox" aria-label={label}>
        <div className="dtf-pad" />
        {values.map(v => (
          <button
            key={v}
            type="button"
            role="option"
            aria-selected={v === value}
            className={`dtf-tick${v === value ? ' is-on' : ''}`}
            onClick={() => tap(v)}
          >
            {pad2(v)}
          </button>
        ))}
        <div className="dtf-pad" />
      </div>
    </div>
  );
}

export default function TimeField({
  value, onChange, now,
}: {
  value: string;
  onChange: (time: string) => void;
  /** The trader's own clock, as HH:MM — passed in rather than read here, so
   *  this component has no opinion about which timezone the app runs on. */
  now: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { h, m } = split(value);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="dtf" ref={wrap}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`dtf-trigger${open ? ' is-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg className="dtf-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.2 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="dtf-value">{pad2(h)}:{pad2(m)}</span>
        <span className="dtf-sub">{partOfDay(h)}</span>
      </button>

      {open && (
        <div className="dtf-pop dtf-time" role="dialog" aria-label="בחירת שעה">
          <div className="dtf-wheels">
            <div className="dtf-band" />
            {/* Hours on the right, minutes on the left — the reading order of
                the page, so 15:39 is scanned the way it is written. */}
            <Wheel label="שעה" values={HOURS} value={h} onPick={v => onChange(`${pad2(v)}:${pad2(m)}`)} />
            <Wheel label="דקה" values={MINUTES} value={m} onPick={v => onChange(`${pad2(h)}:${pad2(v)}`)} />
          </div>
          <div className="dtf-foot">
            <button type="button" className="dtf-btn is-primary" onClick={() => { onChange(now); setOpen(false); }}>
              עכשיו
            </button>
            <button type="button" className="dtf-btn" onClick={() => setOpen(false)}>
              סיימתי
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
