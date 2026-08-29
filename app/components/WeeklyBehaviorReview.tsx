'use client';

import './DailyInsightCard.css';
import { useEffect, useState } from 'react';
import { summarizeWeeklyReview } from '../lib/weeklyReviewSummary';

// ─────────────────────────────────────────────────────────────────────────────
// WeeklyBehaviorReview — did anything about how you trade actually move.
//
// Separate from the weekly performance report, which answers what the week's
// RESULTS looked like. This one answers the question a trader has after a
// month of daily notes: is any of this going anywhere.
//
// A quiet week renders one line saying so. That is the whole discipline of
// this panel — a review that always finds something to report is a review
// nobody reads by the third week, and the standing state ("you still do this,
// it is still unclear") is exactly what feels like content while being none.
//
// IT DOES NOT ASK ANYTHING.
//
// It used to print every open question, verbatim — the same sentences the
// daily insight asks, on the screen where the trader actually answers them.
// Three near-identical lines ("…happened 7 times and it is still unclear when.
// What made you decide that way?"), a fortnight running, on a panel about
// something else. Asking belongs to the daily note. This one reports what
// moved in how the trader traded, and stops there.
// ─────────────────────────────────────────────────────────────────────────────

interface Movement {
  kind: string; label: string;
  direction: 'improving' | 'worsening' | 'steady';
  historicalRate: number; rollingRate: number; delta: number;
}

interface Review {
  improved:  Array<{ kind: string; label: string }>;
  relapsed:  Array<{ kind: string; label: string; times: number }>;
  underTest: Array<{ kind: string; label: string; instruction: string; done: number; of: number }>;
  movement:  Movement[];
  openQuestionCount: number;
  stillUnclear:  Array<{ kind: string; label: string; occurrences: number; opportunities: number }>;
  focus: { kind: string; label: string; status: string } | null;
  quiet: boolean;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

export default function WeeklyBehaviorReview() {
  const [data, setData] = useState<Review | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/coach/weekly-review', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!cancelled) setData((j?.review ?? null) as Review | null); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, []);

  // Never nothing. A panel that renders blank on a week with no findings lets
  // the reader assume there is a conclusion being withheld — and on a normal
  // week what it DID render was a progress bar, which reads exactly like one.
  const moving = data ? data.movement.filter(m => m.direction !== 'steady') : [];
  const summary = summarizeWeeklyReview(data ? {
    improved:  data.improved.length,
    relapsed:  data.relapsed.length,
    underTest: data.underTest.length,
    moving:    moving.length,
    unclear:   data.stillUnclear.length,
  } : null);

  return (
    <section className="wbr" aria-label="הסקירה השבועית של ההתנהגות">
      <header className="wbr-head">
        <span className="wbr-eyebrow">מה זז השבוע</span>
      </header>

      {/* The verdict, before anything else on the panel: is there a conclusion
          this week, or is this a measurement still running. */}
      <div className="wbr-verdict" data-kind={summary.kind}>
        <h3>{summary.title}</h3>
        <p>{summary.detail}</p>
      </div>

      {data && data.improved.length > 0 && (
        <div className="wbr-block" data-tone="good">
          <h4>השתפר</h4>
          {data.improved.map(i => <p key={i.kind}>{i.label}</p>)}
        </div>
      )}

      {/* Kept ahead of everything except an improvement. "This is the second
          time" is the most useful sentence the system has, and a review that
          only looked forward would lose it. */}
      {data && data.relapsed.length > 0 && (
        <div className="wbr-block" data-tone="bad">
          <h4>חזר</h4>
          {data.relapsed.map(r => (
            <p key={r.kind}>{r.label} — פעם {r.times === 1 ? 'שנייה' : `${r.times + 1}`}</p>
          ))}
        </div>
      )}

      {data && data.underTest.length > 0 && (
        <div className="wbr-block">
          <h4>בבדיקה</h4>
          {data.underTest.map(t => (
            <div key={t.kind} className="wbr-test">
              <p>{t.instruction}</p>
              <div className="wbr-bar"><div className="wbr-fill" style={{ width: `${(t.done / t.of) * 100}%` }} /></div>
              <span className="wbr-count">{t.done} / {t.of} עסקאות</span>
            </div>
          ))}
        </div>
      )}

      {/* You against you. Not against other traders and not against a standard
          — the only comparison the data can honestly support. */}
      {moving.length > 0 && (
        <div className="wbr-block">
          <h4>אתה מול עצמך</h4>
          {moving.map(m => (
            <p key={m.kind} data-dir={m.direction}>
              {m.label}: {pct(m.historicalRate)} לאורך ההיסטוריה → {pct(m.rollingRate)} ב-20 האחרונות
            </p>
          ))}
        </div>
      )}

      {data && data.stillUnclear.length > 0 && (
        <div className="wbr-block" data-tone="muted">
          <h4>עדיין לא ברור</h4>
          {data.stillUnclear.map(u => (
            <p key={u.kind}>{u.label} — {u.occurrences} מתוך {u.opportunities}</p>
          ))}
        </div>
      )}

      {data?.focus && (
        <div className="wbr-focus">
          <span className="wbr-eyebrow">לשבוע הבא</span>
          <p>{data.focus.label}</p>
        </div>
      )}
    </section>
  );
}
