'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The date field.
//
// It replaces `<input type="date">`, which the browser draws itself: a white
// LTR calendar in the browser's own fonts, opening on a black RTL Hebrew
// screen. Nothing about it can be styled, and on a screen where every other
// surface is dark it reads as a different application.
//
// It also lets the calendar say WHY a day cannot be picked. The old field
// could only refuse after the fact — you chose Saturday, the form turned red.
// Here Saturday is struck through before it is touched, and the reason is
// written under the grid.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react';
import { closureFor } from '../../lib/market/hours';
import './datetime.css';

const MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];
const DOW_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const DOW_LONG = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Parsed as UTC and read as UTC throughout, so a day never shifts by one
 *  because the browser sits west of Greenwich. */
function parts(dateISO: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  const [y, m, d] = dateISO.split('-').map(Number);
  return { y, m: m - 1, d };
}
function dowOf(dateISO: string): number | null {
  const p = parts(dateISO);
  return p ? new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay() : null;
}
function shift(dateISO: string, days: number): string {
  const p = parts(dateISO);
  if (!p) return dateISO;
  const at = new Date(Date.UTC(p.y, p.m, p.d + days));
  return iso(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

/** Was the exchange shut on this whole day? Asked at midday so the answer is
 *  about the day itself and not about an hour the trader has not typed yet. */
const shutOn = (dateISO: string) => closureFor(dateISO, '12:00') !== null;

export default function DateField({
  value, max, onChange, invalid = false,
}: {
  value: string;
  /** The latest day that may be chosen — today. Later days are shown, faint,
   *  rather than hidden, so the trader can see the calendar continue. */
  max: string;
  onChange: (dateISO: string) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(value);
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const view = parts(cursor) ?? parts(max)!;

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

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
    const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
    const out: (string | null)[] = Array(first).fill(null);
    for (let d = 1; d <= days; d++) out.push(iso(view.y, view.m, d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view.y, view.m]);

  const step = (by: number) => {
    setSlide(by > 0 ? 'next' : 'prev');
    const at = new Date(Date.UTC(view.y, view.m + by, 1));
    setCursor(iso(at.getUTCFullYear(), at.getUTCMonth(), 1));
  };

  const pick = (dateISO: string) => { onChange(dateISO); setOpen(false); };

  /** Opening resets the cursor to the chosen day, so reopening lands there
   *  rather than wherever the trader browsed to and then thought better of. */
  const toggle = () => {
    if (!open) setCursor(value);
    setOpen(o => !o);
  };

  /** Arrow keys walk the grid. Right is earlier and left is later, because
   *  the page is Hebrew and the days run that way on screen. */
  const onKey = (e: React.KeyboardEvent) => {
    const by = e.key === 'ArrowRight' ? -1 : e.key === 'ArrowLeft' ? 1
      : e.key === 'ArrowUp' ? -7 : e.key === 'ArrowDown' ? 7 : 0;
    if (by === 0) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (cursor <= max && !shutOn(cursor)) pick(cursor);
      }
      return;
    }
    e.preventDefault();
    setSlide(null);
    setCursor(shift(cursor, by));
  };

  // Focus follows the cursor, so the keyboard walk is visible.
  useEffect(() => {
    if (!open) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-d="${cursor}"]`)?.focus();
  }, [open, cursor]);

  const dow = dowOf(value);
  const shown = parts(value);
  const yesterday = shift(max, -1);

  return (
    <div className="dtf" ref={wrap}>
      <button
        type="button"
        onClick={toggle}
        className={`dtf-trigger${open ? ' is-open' : ''}${invalid ? ' is-bad' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg className="dtf-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
        </svg>
        <span className="dtf-value">
          {shown ? `${pad(shown.d)}.${pad(shown.m + 1)}.${shown.y}` : '—'}
        </span>
        {dow !== null && <span className="dtf-sub">{DOW_LONG[dow]}</span>}
      </button>

      {open && (
        <div className="dtf-pop" role="dialog" aria-label="בחירת תאריך">
          <div className="dtf-nav">
            {/* In Hebrew the earlier month sits to the right, so the arrow
                that goes back points that way. */}
            <button type="button" className="dtf-arrow" onClick={() => step(-1)} aria-label="חודש קודם">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <div className="dtf-month">{MONTHS[view.m]}<b>{view.y}</b></div>
            <button
              type="button" className="dtf-arrow" onClick={() => step(1)} aria-label="חודש הבא"
              disabled={iso(view.y, view.m, 1) >= max.slice(0, 8) + '01'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>

          <div className="dtf-dows">
            {DOW_SHORT.map((d, i) => (
              <div key={d} className={`dtf-dow${i === 0 || i === 6 ? ' is-shut' : ''}`}>{d}</div>
            ))}
          </div>

          <div
            ref={gridRef}
            className={`dtf-grid${slide ? ` slide-${slide}` : ''}`}
            onAnimationEnd={() => setSlide(null)}
            onKeyDown={onKey}
          >
            {cells.map((d, i) => {
              if (d === null) return <span key={`b${i}`} className="dtf-day is-blank" />;
              const later = d > max;
              const shut = shutOn(d);
              return (
                <button
                  key={d}
                  type="button"
                  data-d={d}
                  disabled={later || shut}
                  onClick={() => pick(d)}
                  tabIndex={d === cursor ? 0 : -1}
                  title={later ? 'התאריך עוד לא הגיע' : shut ? 'אין מסחר ביום הזה' : undefined}
                  className={
                    'dtf-day'
                    + (d === value ? ' is-sel' : '')
                    + (d === max ? ' is-today' : '')
                    + (shut ? ' is-shut' : '')
                    + (later ? ' is-later' : '')
                  }
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>

          <div className="dtf-legend">
            <s>שבת</s>
            <span>· יום עם קו הוא יום שאין בו מסחר</span>
          </div>

          {/* היום first, so in an RTL row it lands on the right — the side the
              thumb reaches, for the answer that is nearly always the one. */}
          <div className="dtf-foot">
            <button
              type="button" className="dtf-btn is-primary"
              disabled={shutOn(max)}
              onClick={() => pick(max)}
            >
              היום
            </button>
            <button
              type="button" className="dtf-btn"
              disabled={shutOn(yesterday)}
              onClick={() => pick(yesterday)}
            >
              אתמול
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
