'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The time field.
//
// It replaces `<input type="time">`, which the browser draws itself and no
// stylesheet reaches. `color-scheme: dark` makes Chrome's version dark rather
// than white, which is why the two filter screens were tolerable and the
// journal was not — but dark is all it makes it: the fonts, the spacing and
// the little spinner are still the browser's.
//
// Two wheels rather than a keypad, because the value is nearly always near
// where the wheel already is — a trader logging a trade scrolls a few notches,
// they do not retype a number.
//
// IT IS USED IN TWO SHAPES. In the journal it is a full-width field with a
// value that always exists. On the rules and analytics screens it is a small
// inline control in a row, and "no time chosen" is a real answer — so `value`
// may be empty, and `clearable` gives that answer back.
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

/** Midday for an empty field: the wheels have to open somewhere, and the
 *  middle of the day is the shortest scroll to anywhere else. */
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
  values, value, onPick, label, blocked,
}: {
  values: number[]; value: number; onPick: (v: number) => void; label: string;
  /** Values that cannot be chosen — on today, the hours that have not
   *  happened. Shown faint rather than removed, so the column keeps its
   *  shape and the trader can see where the day currently ends. */
  blocked?: (v: number) => boolean;
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
      const landed = values[i];
      if (landed === value) return;
      // Scrolled past the end of the day: bounce back to where it stops,
      // rather than reporting a time that has not happened.
      if (blocked?.(landed)) {
        el.scrollTo({ top: values.indexOf(value) * ITEM, behavior: 'smooth' });
        return;
      }
      onPick(landed);
    }, 110);
  };

  const tap = (v: number) => {
    if (blocked?.(v)) return;
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
            disabled={blocked?.(v) ?? false}
            className={`dtf-tick${v === value ? ' is-on' : ''}${blocked?.(v) ? ' is-later' : ''}`}
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
  value, onChange, now, max, compact = false, clearable = false, accent = false,
  placeholder = '--:--', label,
}: {
  /** "HH:MM", or empty for a field nothing has been chosen in yet. */
  value: string;
  /** Called with "HH:MM", or with "" when the trader clears the field. */
  onChange: (time: string) => void;
  /** The trader's own clock, as HH:MM. Passed in rather than read here, so
   *  this component has no opinion about which timezone the app runs on.
   *  Omitted where "now" means nothing — a rule's allowed hours, say. */
  now?: string;
  /** The latest time that may be chosen, as HH:MM. Passed only when the
   *  chosen DATE is today — on any other day every hour is a real hour, and a
   *  wheel that stopped at the current time would refuse yesterday evening. */
  max?: string;
  /** The small inline shape, for a control that sits in a row of others. */
  compact?: boolean;
  /** Offer "נקה". Only where an empty field is a meaningful answer. */
  clearable?: boolean;
  /** Draw the closed field in gold, for a filter that is currently on. */
  accent?: boolean;
  placeholder?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { h, m } = split(value);
  const empty = value === '';

  // The ceiling, split the same way. An hour past the ceiling is blocked
  // outright; a minute is blocked only inside the final hour, because 45 is
  // fine at 14:45 and not at 15:45.
  const ceil = max ? split(max) : null;
  const hourBlocked = ceil ? (v: number) => v > ceil.h : undefined;
  const minuteBlocked = ceil && h >= ceil.h ? (v: number) => v > ceil.m : undefined;

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
        aria-label={label}
        className={
          'dtf-trigger'
          + (compact ? ' is-compact' : '')
          + (open ? ' is-open' : '')
          + (accent && !open ? ' is-accent' : '')
        }
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg className="dtf-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.2 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={`dtf-value${empty ? ' is-empty' : ''}`}>
          {empty ? placeholder : `${pad2(h)}:${pad2(m)}`}
        </span>
        {!compact && !empty && <span className="dtf-sub">{partOfDay(h)}</span>}
      </button>

      {open && (
        <div className="dtf-pop dtf-time" role="dialog" aria-label={label ?? 'בחירת שעה'}>
          <div className="dtf-wheels">
            <div className="dtf-band" />
            {/* Hour first, minute second — which puts the hour on the reading
                side in either direction, so 15:39 is scanned the way it is
                written whether the surrounding page is RTL or LTR. */}
            <Wheel
              label="שעה" values={HOURS} value={h} blocked={hourBlocked}
              // Moving into the final hour can strand the minutes past the
              // ceiling, so they come back with it rather than leaving a time
              // on screen that the form would then refuse.
              onPick={v => onChange(`${pad2(v)}:${pad2(ceil && v === ceil.h && m > ceil.m ? ceil.m : m)}`)}
            />
            <Wheel
              label="דקה" values={MINUTES} value={m} blocked={minuteBlocked}
              onPick={v => onChange(`${pad2(h)}:${pad2(v)}`)}
            />
          </div>
          <div className="dtf-foot">
            {now && (
              <button type="button" className="dtf-btn is-primary" onClick={() => { onChange(now); setOpen(false); }}>
                עכשיו
              </button>
            )}
            {clearable && (
              <button type="button" className="dtf-btn" onClick={() => { onChange(''); setOpen(false); }}>
                נקה
              </button>
            )}
            <button type="button" className="dtf-btn" onClick={() => setOpen(false)}>
              סיימתי
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
