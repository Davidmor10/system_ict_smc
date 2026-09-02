'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// ─────────────────────────────────────────────────────────────────────────────
// The dashboard's line about the journey.
//
// Replaces the tracking line, which showed one thing — the count of an open
// window — and only when one happened to be open. Most days that meant the
// dashboard said nothing at all about whether the trader was going anywhere,
// which is the question the whole system exists to answer.
//
// This says the same count when there is one, and otherwise says what stands:
// how many behaviours have been through a closed window and held, and how many
// are being watched. Both numbers come from /api/coach/journey, the same call
// the full screen makes, so the strip and the page can never disagree.
//
// STILL RENDERS NOTHING WHEN THERE IS NOTHING. A first-week account with no
// detected behaviour and no measurable history gets no strip — not a
// placeholder and not an encouragement. A surface that fills silence with a
// compliment teaches the trader to skim past it, and then it is worthless on
// the day it has something real to say.
//
// The evidence list and the lifecycle live on the page. This is a doorway.
// ─────────────────────────────────────────────────────────────────────────────

interface Strip {
  counts: { working: number; changed: number; watching: number; relapsed: number };
  active: { label: string; what: string; done: number; of: number } | null;
  trajectory: { known: boolean; latest: number | null; delta: number | null };
}

export default function ProgressStrip() {
  const [data, setData] = useState<Strip | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/coach/journey', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d && d.counts) setData(d as Strip); })
      .catch(() => { /* silence is the correct failure here */ });
    return () => { alive = false; };
  }, []);

  if (!data) return null;

  const { counts, active, trajectory } = data;
  const nothingYet =
    counts.working === 0 && counts.changed === 0 && counts.watching === 0 && !trajectory.known;
  if (nothingYet) return null;

  const pct = active && active.of > 0 ? Math.min(100, (active.done / active.of) * 100) : 0;

  return (
    <section className="dp-track dp-rise" aria-label="המסלול">
      <div className="dp-track-head">
        <span className="dp-track-k">◈ המסלול</span>
        {active
          ? <span className="dp-track-label">{active.label}</span>
          : <span className="dp-track-label">אין כרגע חלון פתוח</span>}
        {active && <span className="dp-track-count" dir="ltr">{active.done} / {active.of}</span>}
      </div>

      {active && (
        <>
          <div className="dp-track-rail" role="presentation">
            <span className="dp-track-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="dp-track-what">{active.what}</p>
        </>
      )}

      <div className="dp-track-counts">
        <span className="dp-track-stat">
          <b className="dp-num">{counts.changed}</b>
          <span>השתנו</span>
        </span>
        <span className="dp-track-stat">
          <b className="dp-num">{counts.watching}</b>
          <span>במעקב</span>
        </span>
        {/* Counted separately and never folded into "changed" — a relapse
            hidden inside a success count is the one thing that would make
            this line worth less than nothing. */}
        {counts.relapsed > 0 && (
          <span className="dp-track-stat" data-tone="warn">
            <b className="dp-num">{counts.relapsed}</b>
            <span>חזרו</span>
          </span>
        )}
        {trajectory.known && trajectory.latest !== null && (
          <span className="dp-track-stat" data-tone="score">
            <b className="dp-num">{trajectory.latest}</b>
            <span>ציון למידה</span>
          </span>
        )}
        <Link href="/dashboard/progress" className="dp-track-more">למסלול המלא →</Link>
      </div>

      {active && (
        <p className="dp-track-note">
          מבוסס על מה שאתה מתעד בעצמך. זה מדד, לא המלצה.
        </p>
      )}
    </section>
  );
}
