'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The journey — the one screen that answers "am I moving", not "where am I".
//
// Every other screen in Onyx describes the trader's position: the statistics
// page from five angles, the analytics page from twelve. None of them answers
// the question a person actually stays for, which is whether any of it is
// going anywhere.
//
// The material was all here. The behaviour lifecycle has been running windows
// and judging them since it shipped; the learning score has been computed
// nightly and stored twelve snapshots deep; the evolution timeline carried a
// comment in its own source saying it was not wired into any UI. This screen
// is the window, not the analysis.
//
// THREE RULES IT HOLDS TO
//
//   • A relapse is never folded into a success count. "You fixed three things"
//     while one of them came back is the single claim that would make this
//     screen worth less than nothing.
//   • A verdict of `traded_one_problem_for_another` is printed in those words.
//     The guardrails exist to catch it; describing it as partial success
//     wastes the mechanism that found it.
//   • An unmeasurable learning score is said in words, never drawn. The engine
//     returns a neutral 50 when it has too little history, and a flat line at
//     the midpoint reads as months of standing still to a trader who has
//     simply never been measured.
// ─────────────────────────────────────────────────────────────────────────────

import './journey.css';
import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import EvidenceList from './EvidenceList';
import WeeklyBehaviorReview from './WeeklyBehaviorReview';
import {
  STATUS_LABELS, STATUS_ORDER, VERDICT_LABELS, type JourneyCounts, type Trajectory,
} from '../lib/progress/journey';

interface Active {
  kind: string; label: string; status: string; what: string;
  done: number; of: number; startedAt: string;
}
interface Changed {
  kind: string; label: string; status: string; verdict: string;
  before: number; after: number;
  historicalImproved: boolean; rollingImproved: boolean;
  broken: string[]; relapses: number; at: string;
}
interface Watching {
  kind: string; label: string; status: string;
  occurrences: number; opportunities: number; rate: number;
  isPrimary: boolean; firstDetectedAt: string;
}
interface Evolution {
  fromIsoWeek: string; toIsoWeek: string; description: string | null; status: string;
}
interface LogEvent {
  kind: string; label: string; at: string; from: string | null; to: string; reason: string;
}
interface Journey {
  counts: JourneyCounts;
  active: Active | null;
  changed: Changed[];
  watching: Watching[];
  trajectory: Trajectory;
  evolution: Evolution[];
  events: LogEvent[];
  insufficientEvidence: boolean;
}

/** A date the trader recognises. Their own zone is handled server-side for
 *  anything time-of-day; these are day-level and read the same either way. */
function day(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
}

export default function ProgressView() {
  const [data, setData] = useState<Journey | null | undefined>(undefined);
  const [allEvents, setAllEvents] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/coach/journey', { credentials: 'same-origin', cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive) setData((j as Journey) ?? null); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="jr" dir="rtl">
      <header className="jr-hero jr-sec">
        <div className="jr-eyebrow"><span>◈</span><span>המסלול</span></div>
        <h1 className="jr-h1">מה השתנה אצלך</h1>
        <p className="jr-lede">
          שאר המסכים מתארים איפה אתה עומד. המסך הזה עונה על שאלה אחרת — האם משהו זז.
          כל מה שכאן נמדד מול מה שתיעדת בעצמך, ומול שני בסיסי השוואה שצריכים להסכים.
        </p>
        <Counts data={data} />
      </header>

      {data === undefined && <Loading />}
      {data === null && (
        <div className="jr-band jr-sec">
          <div className="jr-empty">
            <b>לא הצלחנו לטעון את המסלול</b>
            נסה לרענן את הדף. אם זה חוזר — הנתונים עצמם בטוחים, רק התצוגה נכשלה.
          </div>
        </div>
      )}

      {data && (
        <>
          <Working data={data} />
          <ChangedBand data={data} />
          <WatchingBand data={data} />
          <TrajectoryBand data={data} onToggleEvents={() => setAllEvents(v => !v)} allEvents={allEvents} />

          <section className="jr-band jr-sec" data-i="4">
            <div className="jr-band-head">
              <h2 className="jr-band-q">מה זז בשבוע האחרון</h2>
              <span className="jr-band-cap">שבעה ימים</span>
            </div>
            <WeeklyBehaviorReview />
          </section>
        </>
      )}
    </div>
  );
}

/* ── the three counts ─────────────────────────────────────────────────────── */

function Counts({ data }: { data: Journey | null | undefined }) {
  const c = data?.counts;
  const cell = (
    href: string, tone: string, value: number | null, label: string, sub: string,
  ) => (
    <a className="jr-count" data-tone={tone} href={href}>
      <div className="jr-count-v">{value === null ? '—' : value}</div>
      <div className="jr-count-k">{label}</div>
      <div className="jr-count-sub">{sub}</div>
    </a>
  );

  return (
    <div className="jr-counts">
      {cell('#working', 'working', c?.working ?? null, 'בעבודה', 'התנהגות שנמדדת עכשיו בחלון פתוח')}
      {cell('#changed', 'changed', c?.changed ?? null, 'השתנו', 'עברו ניסיון והחזיקו')}
      {cell('#watching', 'watching', c?.watching ?? null, 'במעקב', 'זוהו, עוד לא בשלות לפעולה')}
    </div>
  );
}

function Loading() {
  return (
    <div className="jr-band">
      <div className="jr-skeleton" />
    </div>
  );
}

/* ── 1 · what I am working on ─────────────────────────────────────────────── */

function Working({ data }: { data: Journey }) {
  const a = data.active;
  return (
    <section className="jr-band jr-sec" data-i="1" id="working">
      <div className="jr-band-head">
        <h2 className="jr-band-q">על מה אני עובד עכשיו</h2>
        <span className="jr-band-cap">חלון פתוח</span>
      </div>

      {a ? (
        <div className="jr-panel jr-active">
          <div className="jr-active-top">
            <div className="jr-active-label">{a.label}</div>
            <div className="jr-active-count" dir="ltr">{a.done} / {a.of}</div>
          </div>

          <p className="jr-what">{a.what}</p>

          <div className="jr-rail" role="presentation">
            <span
              className="jr-fill"
              style={{ width: `${a.of > 0 ? Math.min(100, (a.done / a.of) * 100) : 0}%` }}
            />
          </div>

          <Stepper status={a.status} />

          <p className="jr-note">
            נפתח ב־{day(a.startedAt)}. הספירה מבוססת על מה שאתה מתעד בעצמך — זה מדד, לא המלצה.
            החלון נסגר כשמצטברות {a.of} הזדמנויות, ורק אז יש פסיקה.
          </p>

          {/* The trades behind the count. If the detector is picking the wrong
              ones, this is where the trader sees it — and they know their own
              trades better than any detector does. */}
          <EvidenceList kind={a.kind} />
        </div>
      ) : (
        <div className="jr-empty">
          <b>אין כרגע חלון פתוח</b>
          {data.insufficientEvidence
            ? 'עוד לא הצטברו מספיק עסקאות מתועדות כדי לזהות התנהגות חוזרת. זה לא ממצא לטובתך ולא לרעתך — פשוט אין עדיין מה למדוד.'
            : 'התנהגות נכנסת לניסוי רק אחרי שהיא אוששה על מדגם שיכול היה גם לשלול אותה. מה שבמעקב מופיע למטה.'}
        </div>
      )}
    </section>
  );
}

/** Where this behaviour stands in the process.
 *
 *  The lifecycle is the product's whole claim to being a coach rather than a
 *  dashboard, and it lived as English enum members inside the engine. A trader
 *  cannot be moved through a process whose shape they have never seen. */
function Stepper({ status }: { status: string }) {
  const here = STATUS_ORDER.indexOf(status as typeof STATUS_ORDER[number]);
  return (
    <div className="jr-steps" aria-label="שלב בתהליך">
      {/* A Fragment rather than a wrapper: the connector and the step are
          siblings of the flex row, and a wrapper with display:contents loses
          its semantics in some screen readers. */}
      {STATUS_ORDER.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && <span className="jr-step-bar" data-done={here >= 0 && i <= here} />}
          <div className="jr-step" data-state={here < 0 ? 'todo' : i < here ? 'done' : i === here ? 'here' : 'todo'}>
            <span className="jr-step-dot" />
            <span className="jr-step-k">{STATUS_LABELS[s]}</span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/* ── 2 · what I already changed ───────────────────────────────────────────── */

function ChangedBand({ data }: { data: Journey }) {
  return (
    <section className="jr-band jr-sec" data-i="2" id="changed">
      <div className="jr-band-head">
        <h2 className="jr-band-q">מה כבר שיניתי</h2>
        <span className="jr-band-cap">{data.changed.length} נמדדו</span>
      </div>

      {data.changed.length === 0 ? (
        <div className="jr-empty">
          <b>עוד לא נסגר ניסוי</b>
          כאן תופיע כל התנהגות שנמדדה בחלון סגור — עם השיעור לפני ואחרי, ועם מה שנבדק כדי לוודא
          שהשיפור לא בא על חשבון משהו אחר. הרשימה הזו נשארת. היא מה שמצטבר לאורך שנה.
        </div>
      ) : (
        data.changed.map(c => <Result key={`${c.kind}-${c.at}`} c={c} />)
      )}
    </section>
  );
}

function Result({ c }: { c: Changed }) {
  return (
    <div className="jr-panel">
      <div className="jr-result-top">
        <div className="jr-result-label">{c.label}</div>
        <span className="jr-verdict" data-v={c.verdict}>{VERDICT_LABELS[c.verdict] ?? c.verdict}</span>
      </div>

      <div className="jr-move">
        <span className="jr-move-k">לפני</span>
        <span className="jr-move-v" data-side="before">{c.before}%</span>
        <span className="jr-move-arrow" aria-hidden>←</span>
        <span className="jr-move-v" data-side="after">{c.after}%</span>
        <span className="jr-move-k">אחרי</span>
      </div>

      {/* Both baselines. Agreeing is the entire test — a good fortnight and a
          changed habit look identical on the rolling number alone — so the
          reader has to be able to see that they agreed. */}
      <div className="jr-baselines">
        <span className="jr-baseline" data-ok={c.historicalImproved}>
          <span className="jr-baseline-mark" aria-hidden>{c.historicalImproved ? '✓' : '✕'}</span>
          <span>מול כל ההיסטוריה</span>
        </span>
        <span className="jr-baseline" data-ok={c.rollingImproved}>
          <span className="jr-baseline-mark" aria-hidden>{c.rollingImproved ? '✓' : '✕'}</span>
          <span>מול התקופה האחרונה</span>
        </span>
      </div>

      {c.broken.length > 0 && (
        <div className="jr-broken">
          ההתנהגות אכן ירדה, אבל משהו אחר הורע במקביל: {c.broken.join(' · ')}.
          זו לא התקדמות — זו החלפה של בעיה אחת באחרת.
        </div>
      )}

      {c.relapses > 0 && (
        <div className="jr-relapse">
          ◈ חזרה {c.relapses === 1 ? 'פעם אחת' : `${c.relapses} פעמים`} אחרי שנסגרה.
        </div>
      )}

      <p className="jr-note">
        נקבע ב־{day(c.at)} · מצב נוכחי: {STATUS_LABELS[c.status] ?? c.status}
      </p>
    </div>
  );
}

/* ── 3 · what is being watched ────────────────────────────────────────────── */

function WatchingBand({ data }: { data: Journey }) {
  if (data.watching.length === 0) return null;
  return (
    <section className="jr-band jr-sec" data-i="3" id="watching">
      <div className="jr-band-head">
        <h2 className="jr-band-q">מה במעקב</h2>
        <span className="jr-band-cap">טרם בשלות לניסוי</span>
      </div>

      {data.watching.map(w => (
        <div className="jr-watch" key={w.kind}>
          <span className="jr-status" data-primary={w.isPrimary}>{STATUS_LABELS[w.status] ?? w.status}</span>
          <span className="jr-watch-label">{w.label}</span>
          <span className="jr-watch-rate" dir="ltr">
            {w.occurrences}/{w.opportunities}
          </span>
        </div>
      ))}

      <p className="jr-note">
        המונה הוא מספר הפעמים מול מספר ההזדמנויות — לא אחוז מהעסקאות. התנהגות עוברת לניסוי רק
        כשהמדגם גדול מספיק כדי שהוא היה יכול גם לשלול אותה.
      </p>
    </section>
  );
}

/* ── 4 · where this is going ──────────────────────────────────────────────── */

function TrajectoryBand({
  data, allEvents, onToggleEvents,
}: { data: Journey; allEvents: boolean; onToggleEvents: () => void }) {
  const t = data.trajectory;
  const events = allEvents ? data.events : data.events.slice(0, 8);

  return (
    <section className="jr-band jr-sec" data-i="4" id="trajectory">
      <div className="jr-band-head">
        <h2 className="jr-band-q">לאן זה הולך</h2>
        <span className="jr-band-cap">ציון למידה · ציר התפתחות</span>
      </div>

      <div className="jr-panel">
        {t.known && t.latest !== null ? (
          <>
            <div className="jr-curve-top">
              <span className="jr-curve-v" dir="ltr">{t.latest}</span>
              {t.delta !== null && (
                <span className="jr-curve-delta" data-dir={t.delta > 0 ? 'up' : t.delta < 0 ? 'down' : 'flat'} dir="ltr">
                  {t.delta > 0 ? '▲' : t.delta < 0 ? '▼' : '■'} {Math.abs(t.delta)}
                </span>
              )}
              <span className="jr-count-k" style={{ marginTop: 0, paddingBottom: 8 }}>ציון למידה</span>
            </div>
            <Curve points={t.points} />
            <p className="jr-note">
              הציון משווה את המחצית המוקדמת של ההיסטוריה שלך למאוחרת — יחס R ממוצע, יחס רווח,
              ואיכות היתרון. הוא מודד כיוון, לא רווחיות. חמישים הוא נקודת האמצע, לא ציון עובר.
            </p>
          </>
        ) : (
          <div className="jr-empty">
            <b>עוד אין מספיק היסטוריה כדי לומר לאן זה הולך</b>
            הציון משווה תקופה לתקופה, ולכן הוא דורש כמה מדידות שבועיות לפני שיש לו מה להשוות.
            עד אז אין כאן מספר — ובמכוון: מספר ניטרלי היה נראה כמו עמידה במקום.
          </div>
        )}
      </div>

      {data.evolution.length > 0 && (
        <div className="jr-panel">
          <div className="jr-count-k" style={{ marginTop: 0, marginBottom: 14 }}>ציר ההתפתחות</div>
          {data.evolution.map(e => (
            <div className="jr-evo" key={`${e.fromIsoWeek}-${e.toIsoWeek}`}>
              <div className="jr-evo-week" dir="ltr">
                {e.fromIsoWeek === e.toIsoWeek ? e.fromIsoWeek : `${e.fromIsoWeek} → ${e.toIsoWeek}`}
              </div>
              <div className="jr-evo-body">
                <div className="jr-evo-desc" data-empty={e.description === null}>
                  {e.description ?? 'לא זוהה יתרון ברור בתקופה הזו.'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.events.length > 0 && (
        <div className="jr-panel">
          <div className="jr-count-k" style={{ marginTop: 0, marginBottom: 14 }}>יומן התהליך</div>
          {events.map((e, i) => (
            <div className="jr-log" key={`${e.kind}-${e.at}-${i}`}>
              <span className="jr-log-at" dir="ltr">{day(e.at)}</span>
              <span className="jr-log-body">
                {e.label} · <span className="jr-log-to">{STATUS_LABELS[e.to] ?? e.to}</span>
                {e.reason ? ` — ${e.reason}` : ''}
              </span>
            </div>
          ))}
          {data.events.length > 8 && (
            <button type="button" className="jr-more" onClick={onToggleEvents}>
              {allEvents ? 'הצג פחות' : `הצג את כל ${data.events.length} הרשומות`}
            </button>
          )}
        </div>
      )}

      <p className="jr-note">
        אף אחד מהמספרים כאן אינו המלצה. המערכת מודדת מה שתיעדת ומדווחת מה זז — ההחלטות נשארות שלך.{' '}
        <Link href="/dashboard/stats" style={{ color: '#d4af37' }}>לסטטיסטיקות המלאות →</Link>
      </p>
    </section>
  );
}

/** The learning curve.
 *
 *  Drawn only from points whose score was actually computed — the placeholder
 *  head is removed upstream, so nothing here has to know about it.
 *
 *  THE AXIS IS FIXED AT 0–100 AND LABELLED AS SUCH.
 *
 *  Fitting the axis to the data is the default every charting library ships,
 *  and on a bounded score it is a lie of presentation: a four-point drift
 *  would fill the frame corner to corner and read as a collapse. The score
 *  runs 0 to 100, so the axis runs 0 to 100, the midpoint is drawn, and a
 *  modest move is allowed to look modest.
 *
 *  THE MARKERS ARE HTML, NOT <circle>. The path is stretched to the container
 *  with preserveAspectRatio="none", which scales x and y by different factors
 *  — a circle in that space renders as an ellipse, and the first reading came
 *  out a visible blob. Positioning them outside the SVG keeps them round at
 *  any width. */
function Curve({ points }: { points: Array<{ at: string; learning: number }> }) {
  const path = useMemo(() => {
    if (points.length === 0) return null;
    const W = 100, H = 100;
    const step = points.length > 1 ? W / (points.length - 1) : 0;
    const y = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H;
    // RTL: the earliest reading sits on the right, so x runs backwards.
    const pts = points.map((p, i) => ({ x: W - i * step, y: y(p.learning) }));
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    return {
      line,
      // Closed back along the baseline, so a gentle slope still has a shape.
      area: points.length > 1
        ? `${line} L${pts[pts.length - 1].x.toFixed(2)},${H} L${pts[0].x.toFixed(2)},${H} Z`
        : null,
      pts,
      single: points.length === 1,
    };
  }, [points]);

  if (!path) return null;

  return (
    <div className="jr-chart-wrap">
      {/* Labelled, and first in the DOM so RTL puts it at the reading start.
          An unlabelled axis is where a reader assumes it was fitted. */}
      <div className="jr-axis" aria-hidden>
        <span>100</span><span>50</span><span>0</span>
      </div>

      <div className="jr-chart-box">
        <svg className="jr-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="עקומת ציון הלמידה">
          <defs>
            <linearGradient id="jrFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4af37" stopOpacity="0.20" />
              <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* The midpoint, so the curve is read against something. It is not a
              passing mark, and the note below says so. */}
          <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.16)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />

          {path.area && <path d={path.area} fill="url(#jrFill)" stroke="none" />}
          {!path.single && (
            <path d={path.line} fill="none" stroke="#d4af37" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          )}
        </svg>

        {/* Every reading, not only the last: how many measurements there are is
            itself information about what the line is worth. */}
        {path.pts.map((p, i) => (
          <span
            key={i}
            className="jr-dot"
            data-last={i === path.pts.length - 1}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          />
        ))}
      </div>
    </div>
  );
}
