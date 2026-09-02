'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { STATUS_LABELS } from '../lib/progress/journey';

// ─────────────────────────────────────────────────────────────────────────────
// The state panel at the top of the dashboard.
//
// ONE CLAIM. Not four coloured categories, not six scores.
//
// A row of traffic lights across ביצועים / משמעת / סיכון / ביצוע looks like a
// diagnosis and behaves like a score with three values and no audit trail: a
// trader can argue with "5 out of 22 opportunities" and cannot argue with a
// red dot. It also has no colour for the state a new account is in most of
// the time, which is "not enough data yet" — so it would have to invent one.
//
// THREE THINGS THIS PANEL WILL NOT SAY, ENFORCED BY WHAT IT READS
//
//   • WHY. Every sentence here is a count over a denominator, or a line the
//     experiment engine wrote. Trade data can establish where a behaviour
//     concentrates; it cannot establish what the trader was thinking, and
//     docs/ai-architecture.md makes that a rule rather than a preference.
//   • WHAT TO DO. The instruction shown during an open window is the one the
//     trader agreed to measure, with a defined window and a failing
//     condition — not advice this panel generated.
//   • A SCORE. There is no number here that was assembled from weights.
//
// What it does say, in order: the one best-supported fact about this trader
// right now, where that behaviour stands in the process, what is still
// unknown, and what has already changed and held.
// ─────────────────────────────────────────────────────────────────────────────

interface Active { label: string; what: string; done: number; of: number; status: string }
interface Watching {
  label: string; status: string; occurrences: number; opportunities: number; isPrimary: boolean;
}
interface State {
  counts: { working: number; changed: number; watching: number; relapsed: number };
  active: Active | null;
  watching: Watching[];
  insufficientEvidence: boolean;
}

export default function CurrentState() {
  const [data, setData] = useState<State | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/coach/journey', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d && d.counts) setData(d as State); })
      .catch(() => { /* silence is the correct failure here */ });
    return () => { alive = false; };
  }, []);

  if (!data) return null;

  const { counts, active, watching, insufficientEvidence } = data;
  const primary = watching.find(w => w.isPrimary) ?? watching[0] ?? null;

  // Nothing detected and nothing ever changed. The panel says so rather than
  // disappearing: on a screen about the trader's state, an absent panel and a
  // clean bill of health look identical.
  const nothing = !active && !primary && counts.changed === 0;

  return (
    <section className="dp-state dp-rise" aria-label="מצב נוכחי">
      <div className="dp-state-head">
        <span className="dp-state-k">◈ מצב נוכחי</span>
        <Link href="/dashboard/progress" className="dp-state-more">להיסטוריה המלאה →</Link>
      </div>

      {active ? (
        <>
          <div className="dp-state-claim">
            <span className="dp-state-chip">{STATUS_LABELS[active.status] ?? 'במדידה'}</span>
            <span className="dp-state-subject">{active.label}</span>
            <span className="dp-state-count" dir="ltr">{active.done} / {active.of}</span>
          </div>
          <div className="dp-state-rail" role="presentation">
            <span
              className="dp-state-fill"
              style={{ width: `${active.of > 0 ? Math.min(100, (active.done / active.of) * 100) : 0}%` }}
            />
          </div>
          {/* The engine's sentence, not this panel's. */}
          <p className="dp-state-what">{active.what}</p>
        </>
      ) : primary ? (
        <div className="dp-state-claim">
          <span className="dp-state-chip">{STATUS_LABELS[primary.status] ?? primary.status}</span>
          <span className="dp-state-subject">{primary.label}</span>
          <span className="dp-state-count" dir="ltr">
            {primary.occurrences} / {primary.opportunities}
          </span>
        </div>
      ) : (
        <p className="dp-state-what dp-state-quiet">
          {nothing
            ? 'אין כרגע התנהגות חוזרת שזוהתה.'
            : 'אין כרגע התנהגות במעקב.'}
        </p>
      )}

      <div className="dp-state-foot">
        <span className="dp-state-unknown">{unknownLine(data, primary)}</span>
        {counts.changed > 0 && (
          <span className="dp-state-won">
            <b className="dp-num">{counts.changed}</b> כבר השתנו והחזיקו
            {counts.relapsed > 0 && <em> · <b className="dp-num">{counts.relapsed}</b> חזרו</em>}
          </span>
        )}
      </div>
    </section>
  );
}

/** What the system does not know yet, said out loud.
 *
 *  The most important line on the panel. A state screen that only ever reports
 *  findings teaches the trader that silence means "fine", and the most common
 *  truth in a trader's first month is neither a finding nor a clean bill — it
 *  is that there is not enough logged yet to say.
 *
 *  IT MUST DESCRIBE THE CLAIM ABOVE IT. The first version always described the
 *  primary WATCHED finding, so with a window open the panel said "במדידה" on
 *  one line and "not yet confirmed as a repeated behaviour" on the next — two
 *  sentences about two different behaviours, reading as a contradiction about
 *  one. Whatever the panel put in the claim decides what "unknown" means. */
function unknownLine(d: State, primary: Watching | null): string {
  if (d.insufficientEvidence) {
    return 'עוד לא הצטברו מספיק עסקאות מתועדות כדי לזהות התנהגות חוזרת. זה לא ממצא לטובתך ולא לרעתך.';
  }

  // A window is open: the unknown is its result, not whether the behaviour is
  // real. It would not have a window if it had not already been confirmed.
  if (d.active) {
    const left = Math.max(0, d.active.of - d.active.done);
    return left > 0
      ? `אין עדיין פסיקה. החלון נסגר אחרי עוד ${left} הזדמנויות, ורק אז נמדד אם משהו השתנה.`
      : 'החלון התמלא. הפסיקה תיקבע בריצה הלילית הקרובה.';
  }

  if (primary && (primary.status === 'detected' || primary.status === 'investigating')) {
    return 'עוד לא אושש שזו התנהגות חוזרת — המדגם צריך להיות גדול מספיק כדי שהיה יכול גם לשלול אותה.';
  }

  const others = d.watching.filter(w => !w.isPrimary).length;
  if (others > 0) {
    return `עוד ${others} התנהגויות בבדיקה, אף אחת מהן עדיין לא הגיעה לניסוי.`;
  }
  return 'המספרים כאן הם ספירה מול הזדמנויות, לא המלצה.';
}
