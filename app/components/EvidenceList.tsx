'use client';

import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// EvidenceList — the trades behind a claim.
//
// Opens under a finding. Shows every trade the detector looked at, marked for
// whether it counted, with the numbers it used.
//
// Both sides are shown, deliberately. A list of only the trades that counted
// is a prosecution; the ones that didn't are what make a rate mean anything,
// and they are where a misclassification is easiest to spot. The trader who
// opens this and says "three of those were managed exactly as planned" is the
// feature working, not the feature failing.
// ─────────────────────────────────────────────────────────────────────────────

interface Check {
  id: string; label: string;
  status: 'agrees' | 'disagrees' | 'unverifiable';
  reported?: string; recorded?: string;
}

interface EvidenceTrade {
  id: string;
  date: string;
  time: string | null;
  symbol: string;
  direction: string;
  entry: number;
  stop: number;
  target: number | null;
  exit: number | null;
  result: string;
  rMultiple: number | null;
  session: string | null;
  counted: boolean;
  checks?: Check[];
}

interface Evidence {
  label: string;
  occurrences: number;
  opportunities: number;
  trades: EvidenceTrade[];
}

const num = (n: number | null | undefined) =>
  n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(2);

export default function EvidenceList({ kind }: { kind: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Evidence | null | undefined>(undefined);

  useEffect(() => {
    if (!open || data !== undefined) return;
    let cancelled = false;
    fetch(`/api/coach/evidence?kind=${encodeURIComponent(kind)}`, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!cancelled) setData((j as Evidence) ?? null); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [open, data, kind]);

  return (
    <div className="ev">
      <button type="button" className="ev-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? 'הסתר את העסקאות' : 'הצג את העסקאות שמאחורי המספר'}
      </button>

      {open && data === undefined && <p className="ev-note">טוען…</p>}
      {open && data === null && <p className="ev-note">לא הצלחנו לטעון את העסקאות.</p>}

      {open && data && (
        <>
          <p className="ev-note">
            {data.occurrences} מתוך {data.opportunities} — כל העסקאות שהבדיקה הסתכלה עליהן,
            כולל אלה שלא נספרו.
          </p>
          <div className="ev-scroll">
            <table className="ev-table">
              <thead>
                <tr>
                  <th>תאריך</th><th>נכס</th><th>כניסה</th><th>סטופ</th>
                  <th>יעד</th><th>יציאה</th><th>R</th><th>נספרה</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.trades.map(t => (
                  <tr key={t.id} data-counted={t.counted}>
                    <td>{t.date}{t.time ? ` ${t.time}` : ''}</td>
                    <td>{t.symbol} {t.direction === 'SHORT' ? '↓' : '↑'}</td>
                    <td>{num(t.entry)}</td>
                    <td>{num(t.stop)}</td>
                    <td>{num(t.target)}</td>
                    <td>{num(t.exit)}</td>
                    <td>{t.rMultiple == null ? '—' : `${t.rMultiple.toFixed(2)}R`}</td>
                    <td>{t.counted ? '●' : '·'}</td>
                    {/* A trade whose own numbers contradict what was written
                        about it. Marked, not hidden: it is still evidence, it
                        is just evidence worth checking first. */}
                    <td title={(t.checks ?? []).filter(c => c.status === 'disagrees')
                      .map(c => `${c.label}: ${c.reported} מול ${c.recorded}`).join(' · ')}>
                      {(t.checks ?? []).some(c => c.status === 'disagrees') ? '⚠' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ev-foot">
            רואה עסקה שסומנה בטעות? ענה למאמן בתיבה למעלה — התשובה נכנסת לניתוח.
          </p>
        </>
      )}
    </div>
  );
}
