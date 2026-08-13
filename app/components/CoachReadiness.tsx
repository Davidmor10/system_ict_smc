'use client';

import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// CoachReadiness — what the coach can see, and what it is waiting for.
//
// Shown when the coach has nothing to say, which for a new trader is most
// mornings. Silence is the correct output when the evidence isn't there; it is
// also indistinguishable from a broken feature, and a trader who reads it as
// broken stops filling the fields that would have fixed it.
//
// So each row is a fact about their own journal with a number they can move,
// and the action that moves it. A detector that is ready says so once and
// stops taking up space.
// ─────────────────────────────────────────────────────────────────────────────

interface Detector {
  kind:   string;
  label:  string;
  state:  'ready' | 'partial' | 'blocked';
  have:   number;
  need:   number;
  action: string;
}

interface Readiness {
  tradesTotal:   number;
  tradesDecided: number;
  detectors:     Detector[];
  readyCount:    number;
}

export default function CoachReadiness() {
  const [data, setData] = useState<Readiness | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/coach/readiness', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!cancelled) setData((j?.readiness ?? null) as Readiness | null); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, []);

  // Loading and failure both render nothing. This panel explains an absence;
  // it must never become one more thing that looks broken.
  if (!data) return null;

  const waiting = data.detectors.filter(d => d.state !== 'ready');
  const ready   = data.detectors.filter(d => d.state === 'ready');

  return (
    <section className="cr" aria-label="מה המאמן צריך">
      <header className="cr-head">
        <span className="cr-eyebrow">מה המאמן רואה</span>
        <span className="cr-tally">
          {data.readyCount} מתוך {data.detectors.length} בדיקות פעילות · {data.tradesDecided} עסקאות סגורות
        </span>
      </header>

      {ready.length > 0 && (
        <ul className="cr-list">
          {ready.map(d => (
            <li key={d.kind} className="cr-row" data-state="ready">
              <span className="cr-mark">✓</span>
              <span className="cr-label">{d.label}</span>
              <span className="cr-count">{d.have}</span>
            </li>
          ))}
        </ul>
      )}

      {waiting.length > 0 && (
        <ul className="cr-list">
          {waiting.map(d => (
            <li key={d.kind} className="cr-row" data-state={d.state}>
              <span className="cr-mark">{d.state === 'blocked' ? '—' : '·'}</span>
              <div className="cr-body">
                <div className="cr-line">
                  <span className="cr-label">{d.label}</span>
                  <span className="cr-count">{d.have} / {d.need}</span>
                </div>
                {/* The bar is the honest part: it is the same two numbers, and
                    it turns "not yet" into a distance. */}
                <div className="cr-bar" role="presentation">
                  <div className="cr-fill" style={{ width: `${Math.min(100, (d.have / d.need) * 100)}%` }} />
                </div>
                <p className="cr-action">{d.action}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="cr-foot">
        המאמן שותק עד שיש מספיק כדי לומר משהו נכון. זה מה שחסר לו — לא כמה זמן לחכות.
      </p>
    </section>
  );
}
