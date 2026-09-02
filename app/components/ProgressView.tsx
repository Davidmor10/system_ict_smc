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
//   • No score. A learning-score curve shipped here and was pulled a day
//     later: it could not say WHICH habit moved, only that a number had, and
//     a number going up with no attribution is a vanity metric. The engine
//     still runs nightly. It gets a surface when it can name the cause.
//
// This screen is the HISTORY. What the trader should look at today is the
// state panel at the top of the dashboard; this is where they come to see
// whether the last three months went anywhere.
// ─────────────────────────────────────────────────────────────────────────────

import './journey.css';
import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import EvidenceList from './EvidenceList';
import WeeklyBehaviorReview from './WeeklyBehaviorReview';
import {
  STATUS_LABELS, STATUS_ORDER, VERDICT_LABELS, type JourneyCounts,
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
          ההיסטוריה שלך כסוחר — כל התנהגות שזוהתה, מה קרה כשבדקת אותה, ומה החזיק.
          נמדד מול מה שתיעדת בעצמך, ומול שני בסיסי השוואה שצריכים להסכים.
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
          <HistoryBand data={data} onToggleEvents={() => setAllEvents(v => !v)} allEvents={allEvents} />

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

function HistoryBand({
  data, allEvents, onToggleEvents,
}: { data: Journey; allEvents: boolean; onToggleEvents: () => void }) {
  const events = allEvents ? data.events : data.events.slice(0, 8);

  if (data.evolution.length === 0 && data.events.length === 0) return null;

  return (
    <section className="jr-band jr-sec" data-i="4" id="history">
      <div className="jr-band-head">
        <h2 className="jr-band-q">איך הגעת לכאן</h2>
        <span className="jr-band-cap">ציר התפתחות · יומן התהליך</span>
      </div>

      {data.evolution.length > 0 && (
        <div className="jr-panel">
          <div className="jr-panel-k">ציר ההתפתחות</div>
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
          <p className="jr-note">
            כל שורה היא תקופה שבה ההשערה על היתרון שלך נשארה זהה. שבוע שבו לא זוהה יתרון ברור
            נרשם ככזה ולא מושמט — זה חלק מהתמונה.
          </p>
        </div>
      )}

      {data.events.length > 0 && (
        <div className="jr-panel">
          <div className="jr-panel-k">יומן התהליך</div>
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
        אין כאן ציון ואין המלצה. המערכת מראה מה עשית, אם זה חוזר, ומה קרה כשבדקת את זה —
        מה לשנות נשאר שלך.{' '}
        <Link href="/dashboard/stats" style={{ color: '#d4af37' }}>לסטטיסטיקות המלאות →</Link>
      </p>
    </section>
  );
}
