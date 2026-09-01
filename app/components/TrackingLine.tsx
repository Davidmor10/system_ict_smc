'use client';

import { useEffect, useState } from 'react';
import EvidenceList from './EvidenceList';

/** What the trader is currently being counted on — one line, above the numbers.
 *
 *  The behaviour layer has designed and judged these windows since it shipped,
 *  and nothing ever showed one. A measurement nobody can see does not change
 *  anything: the count moving is the entire mechanism, and it was running in
 *  the dark.
 *
 *  Renders nothing when nothing is being tracked. Not a placeholder, not an
 *  invitation — a surface that fills silence with encouragement teaches the
 *  trader to skim past it, and then it is useless on the day it has something
 *  real to say.
 *
 *  Every sentence it prints is a measurement, never an instruction: the source
 *  is a field the trader fills in themselves, and what the line reports is how
 *  many times it has been filled. */
interface Active {
  /** The behaviour being counted, so the claim can be opened. Without it the
   *  line states a number the trader has no way to check — and the number is
   *  the one the whole window is built on. */
  kind: string;
  label: string;
  what: string;
  done: number;
  of: number;
}

export default function TrackingLine() {
  const [active, setActive] = useState<Active | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/coach/tracking', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d?.active) setActive(d.active as Active); })
      .catch(() => { /* silence is the correct failure here */ });
    return () => { alive = false; };
  }, []);

  if (!active) return null;

  const pct = active.of > 0 ? Math.min(100, (active.done / active.of) * 100) : 0;

  return (
    <section className="dp-track dp-rise" aria-label="במעקב">
      <div className="dp-track-head">
        <span className="dp-track-k">◈ במעקב</span>
        <span className="dp-track-label">{active.label}</span>
        <span className="dp-track-count" dir="ltr">{active.done} / {active.of}</span>
      </div>
      {/* The count as a line as well as a number — the point of the window is
          that it visibly fills. */}
      <div className="dp-track-rail" role="presentation">
        <span className="dp-track-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="dp-track-what">{active.what}</p>
      <p className="dp-track-note">
        מבוסס על מה שאתה מתעד בעצמך. זה מדד, לא המלצה.
      </p>
      {/* The trades behind the count. A window measures one behaviour for ten
          opportunities; if the detector is picking the wrong trades, this is
          where the trader sees it — and they know their own trades better than
          any detector does. */}
      <EvidenceList kind={active.kind} />
    </section>
  );
}
