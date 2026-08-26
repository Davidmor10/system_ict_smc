'use client';

import { useMemo, useState } from 'react';
import './Evidence.css';
import { rMultiple, plannedRR, tradePnL } from '../lib/journal';
import type { TradeEntry } from '../lib/journal';
import { SESS } from '../lib/sessions';

// ─────────────────────────────────────────────────────────────────────────────
// PatternEvidence — the trades behind a pattern card.
//
// The behaviour findings have had this since the coach shipped; the pattern
// cards never did. That gap is how "סגירה שיקולית — 10 מתוך 33" stayed wrong
// for a fortnight: the number was on screen, the trades behind it were not,
// and the only way to check it was to read the detector's source.
//
// WHY THIS ONE NEEDS NO ROUTE
//
// Patterns are discovered in the browser, from the journal the page already
// loaded, and every candidate carries the exact ids of the trades its slice
// selected. So the drill-down is a lookup, not a fetch — no endpoint, no
// round trip, and no way for the list to disagree with the number above it,
// because both come from the same array.
//
// WHAT IT SHOWS
//
// The slice only. Unlike the behaviour evidence — where the trades that did
// NOT count are what make a rate mean anything — a pattern's claim is about
// this group against the rest of the journal, and the rest of the journal is
// every other trade. Listing it would be listing the journal.
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_HE: Record<string, string> = Object.fromEntries(SESS.map(s => [s.key, s.he]));

const RESULT_HE: Record<string, string> = {
  WIN: 'מנצחת', LOSS: 'מפסידה', BE: 'אפס', OPEN: 'פתוחה',
};

const num = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(2);

const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(0)}`;

export default function PatternEvidence({
  tradeIds,
  trades,
  subject,
}: {
  tradeIds: number[];
  /** The journal as the page already holds it. */
  trades: TradeEntry[];
  /** The slice's label, repeated in the note so an open card still says what
   *  it is once the reader has scrolled past the heading. */
  subject: string;
}) {
  const [open, setOpen] = useState(false);

  // Journal order, newest first — the order the trader reads their own journal
  // in, so a row is findable by memory rather than by id.
  const rows = useMemo(() => {
    const wanted = new Set(tradeIds);
    return trades
      .filter(t => wanted.has(t.id))
      .sort((a, b) => (b.dateISO + (b.time ?? '')).localeCompare(a.dateISO + (a.time ?? '')));
  }, [tradeIds, trades]);

  // A slice whose trades are no longer in the journal — edited or deleted since
  // the insight was cached. Saying so beats a short list that looks complete.
  const missing = tradeIds.length - rows.length;

  if (!tradeIds.length) return null;

  return (
    <div className="ev">
      <button type="button" className="ev-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? 'הסתר את העסקאות' : `הצג את ${tradeIds.length} העסקאות שמאחורי המספר`}
      </button>

      {open && (
        <>
          <p className="ev-note">
            כל העסקאות ש&quot;{subject}&quot; מכסה. אלה המספרים שמהם חושב הדפוס.
            {missing > 0 && ` ${missing} מהן כבר לא ביומן.`}
          </p>
          <div className="ev-scroll">
            <table className="ev-table">
              <thead>
                <tr>
                  <th>תאריך</th><th>נכס</th><th>סשן</th><th>כניסה</th><th>סטופ</th>
                  <th>יעד</th><th>תוצאה</th><th>R מתוכנן</th><th>R בפועל</th><th>תוצאה $</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(t => {
                  const realized = rMultiple(t);
                  const planned  = plannedRR(t);
                  return (
                    // Decided trades carry the claim and read first; an OPEN
                    // one is in the slice and has not finished happening, so it
                    // stays visible and stays dim.
                    <tr key={t.id} data-counted={t.result === 'WIN' || t.result === 'LOSS'}>
                      <td>{t.dateISO}{t.time ? ` ${t.time}` : ''}</td>
                      <td>{t.symbol} {t.direction === 'SHORT' ? '↓' : '↑'}</td>
                      <td>{SESSION_HE[t.session] ?? t.session ?? '—'}</td>
                      <td>{num(t.entry)}</td>
                      <td>{num(t.stop)}</td>
                      <td>{num(t.target)}</td>
                      <td>{RESULT_HE[t.result] ?? t.result}</td>
                      <td>{planned == null ? '—' : `${planned.toFixed(2)}R`}</td>
                      <td>{realized == null ? '—' : `${realized.toFixed(2)}R`}</td>
                      <td>{money(tradePnL(t))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="ev-foot">
            רואה עסקה שלא שייכת לכאן? תקן אותה ביומן — הדפוסים מחושבים מחדש בכל טעינה.
          </p>
        </>
      )}
    </div>
  );
}
