'use client';

// ─────────────────────────────────────────────────────────────────────────────
// המסלול — the trader's record, one row per behaviour.
//
// The dashboard's state panel answers "what do I know about myself right now".
// This answers the other question: has any of it moved, and what happened when
// I tried to change it.
//
// EVERY KIND GETS A ROW, INCLUDING THE ONES THAT NEVER FIRED.
//
// The detector taxonomy is a closed set of five. Grouping five things into
// stage buckets — the first version — scattered each behaviour's history and
// made the ones that never fired vanish, so the page could never say what the
// system actually watches. A row that says "looked at 24 opportunities, not
// found as a repeating pattern" is information; an absent row is not.
//
// The wording of those rows is doing real work. Five lines that mostly read
// "not yet detected" must not land as a list of pending accusations, so an
// undetected row states what was examined and stops. It never congratulates
// either — "no problem here" from a denominator of zero is the same invention
// as a neutral score.
//
// AND THE FIVE ARE NOT EVERYTHING. A trader whose real problem is none of them
// has already written it down as one of their own rules, and ticked it on the
// trade form. Those arrive as rows of the same shape, marked as theirs, with
// the same denominator. They carry no lifecycle stage: nothing here was
// confirmed against a counter-example and no experiment has run on it, and
// borrowing that vocabulary without the evidence behind it would be a lie the
// rest of this screen is built to avoid.
// ─────────────────────────────────────────────────────────────────────────────

import './journey.css';
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import EvidenceList from './EvidenceList';
import { STATUS_LABELS, STATUS_ORDER, VERDICT_LABELS, type JourneyCounts } from '../lib/progress/journey';
import { TREND_LABELS, summarizeJourney, undetectedNote, type JourneyRow } from '../lib/progress/rows';
import { q } from '../lib/hebrew';

interface Journey {
  counts: JourneyCounts;
  rows: JourneyRow[];
  hasRules: boolean;
  gradedTrades: number;
  insufficientEvidence: boolean;
}

function day(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

export default function ProgressView() {
  const [data, setData] = useState<Journey | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/coach/journey', { credentials: 'same-origin', cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive) setData((j as Journey) ?? null); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, []);

  const builtin = data?.rows.filter(r => r.source === 'builtin') ?? [];
  const mine = data?.rows.filter(r => r.source === 'rule') ?? [];

  return (
    <div className="jr" dir="rtl">
      <header className="jr-hero jr-sec">
        <div className="jr-eyebrow"><span>◈</span><span>המסלול</span></div>
        <h1 className="jr-h1">מה השתנה אצלך</h1>
        {/* One line only. The summary below says the rest, and saying it
            twice is how a page starts feeling like filler. */}
        <p className="jr-lede">מה שקורה היום נמצא בלוח הבקרה. כאן זה לאורך זמן.</p>
        {data && <Summary rows={data.rows} />}
        {data && <Counts counts={data.counts} />}
      </header>

      {data === undefined && <div className="jr-band"><div className="jr-skeleton" /></div>}

      {data === null && (
        <div className="jr-band jr-sec">
          <div className="jr-empty">
            <b>לא הצלחנו לטעון את המסלול</b>
            נסה לרענן את הדף. הנתונים עצמם בטוחים — רק התצוגה נכשלה.
          </div>
        </div>
      )}

      {data && (
        <>
          <section className="jr-band jr-sec" data-i="1" id="behaviours">
            <div className="jr-band-head">
              <h2 className="jr-band-q">מה המערכת בודקת עליך</h2>
              <span className="jr-band-cap">{builtin.length} התנהגויות</span>
            </div>

            {builtin.map(r => (
              <Row key={r.kind} r={r} open={open === r.kind} onToggle={() => setOpen(o => (o === r.kind ? null : r.kind))} />
            ))}

            <p className="jr-note">
              הרשימה הזו סגורה, וזה מכוון: כל שורה כאן נמדדת מתוך מה שתיעדת, מול מספר ההזדמנויות
              שהיו לה. יש התנהגות שישית שהמערכת לא בודקת — כניסה מיד אחרי הפסד — כי היומן שומר את
              שעת הכניסה ולא את שעת הסגירה, ואי אפשר להבדיל בינה לבין כניסה רגילה. גלאי שמנחש גרוע
              מגלאי חסר.
            </p>
          </section>

          <MyRules rows={mine} data={data} />

          <section className="jr-band jr-sec" data-i="3">
            <p className="jr-note">
              אין כאן ציון ואין המלצה. המערכת מראה מה עשית, אם זה חוזר, ומה קרה כשבדקת את זה —
              מה לשנות נשאר שלך.{' '}
              <Link href="/dashboard/stats" style={{ color: '#d4af37' }}>לסטטיסטיקות המלאות →</Link>
              {' · '}
              <Link href="/dashboard/ai-analytics" style={{ color: '#d4af37' }}>לציר ההתפתחות →</Link>
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/* ── the header counts ────────────────────────────────────────────────────── */

function Counts({ counts }: { counts: JourneyCounts }) {
  const cell = (tone: string, value: number, label: string, sub: string) => (
    <div className="jr-count" data-tone={tone} key={label}>
      <div className="jr-count-v">{value}</div>
      <div className="jr-count-k">{label}</div>
      <div className="jr-count-sub">{sub}</div>
    </div>
  );
  return (
    <div className="jr-counts">
      {cell('working', counts.working, 'בעבודה', 'נמדדת עכשיו')}
      {cell('changed', counts.changed, 'השתנו', 'שינית והשינוי החזיק')}
      {cell('watching', counts.watching, 'במעקב', 'ראינו אותן — עוד לא ניסינו לשנות')}
    </div>
  );
}

/** The page in sentences.
 *
 *  Derived from the rows underneath it, so it cannot drift from them and costs
 *  no model call. It exists because the page was a table of rates: every row a
 *  percentage and a pair of percentages, and nothing on the screen a person
 *  would read aloud. */
function Summary({ rows }: { rows: JourneyRow[] }) {
  const { lines } = summarizeJourney(rows);
  return (
    <div className="jr-summary">
      {lines.map((l, i) => <p key={i} className="jr-summary-line" data-lead={i === 0}>{l}</p>)}
    </div>
  );
}

/* ── one behaviour ────────────────────────────────────────────────────────── */

function Row({ r, open, onToggle }: { r: JourneyRow; open: boolean; onToggle: () => void }) {
  const undetected = r.status === null;

  return (
    <div className="jr-row" data-stage={r.stage} data-open={open}>
      <div className="jr-row-top">
        <span className="jr-status" data-primary={r.isPrimary} data-undetected={undetected}>
          {undetected ? 'לא ראינו את זה' : STATUS_LABELS[r.status!] ?? r.status}
        </span>
        <span className="jr-row-label">{r.label}</span>
        {r.opportunities > 0 && (
          <span className="jr-row-count" dir="ltr">{r.occurrences} / {r.opportunities}</span>
        )}
      </div>

      {undetected ? (
        <p className="jr-row-note">{undetectedNote(r.opportunities)}</p>
      ) : (
        <>
          <div className="jr-row-meta">
            {r.rate !== null && (
              <span className="jr-meta">
                <span className="jr-meta-k">שיעור</span>
                <span className="jr-meta-v jr-n">{pct(r.rate)}</span>
              </span>
            )}
            {/* The weekly panel used to say this for the whole account. Per
                row it is the same pair the improvement verdict is judged on:
                the recent window against the whole history. */}
            <span className="jr-meta" data-trend={r.trend}>
              <span className="jr-meta-k">לאחרונה</span>
              <span className="jr-meta-v">{TREND_LABELS[r.trend]}</span>
            </span>
            {r.historicalRate !== null && r.rollingRate !== null && (
              <span className="jr-meta">
                <span className="jr-meta-k">היסטורי / אחרון</span>
                <span className="jr-meta-v jr-n" dir="ltr">{pct(r.historicalRate)} → {pct(r.rollingRate)}</span>
              </span>
            )}
            {r.relapses > 0 && (
              <span className="jr-meta" data-tone="warn">
                <span className="jr-meta-k">חזרה</span>
                <span className="jr-meta-v jr-n">{r.relapses}</span>
              </span>
            )}
          </div>

          {/* Two rows reading 6/34 with the same rates looked like a bug and
              were not. What was missing is whether they are about the same
              trades — which the counts cannot say and the trade ids can. */}
          {r.overlap && (
            <p className="jr-overlap">
              מתוך {r.occurrences} המקרים, {r.overlap.shared} הם אותן עסקאות שסימנת גם תחת:{' '}
              <b>{r.overlap.label}</b>. שתי השורות סופרות שם את אותו מעשה.
            </p>
          )}

          {r.window && <Window w={r.window} kind={r.kind} />}
          {r.result && <Result res={r.result} />}

          <button type="button" className="jr-more" onClick={onToggle} aria-expanded={open}>
            {open ? 'סגור את ההיסטוריה' : 'ההיסטוריה של ההתנהגות הזו'}
          </button>

          {open && (
            <div className="jr-row-history">
              <Stepper status={r.status!} />
              {r.firstDetectedAt && (
                <p className="jr-row-note">זוהתה לראשונה ב-{day(r.firstDetectedAt)}.</p>
              )}
              {r.events.length > 0 ? (
                r.events.map((e, i) => (
                  <div className="jr-log" key={`${e.at}-${i}`}>
                    <span className="jr-log-at" dir="ltr">{day(e.at)}</span>
                    <span className="jr-log-body">
                      <span className="jr-log-to">{STATUS_LABELS[e.to] ?? e.to}</span>
                      {e.reason ? ` — ${e.reason}` : ''}
                    </span>
                  </div>
                ))
              ) : (
                <p className="jr-row-note">עוד לא נרשמו מעברים בתהליך.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Window({ w, kind }: { w: { what: string; done: number; of: number }; kind: string }) {
  return (
    <div className="jr-window">
      <div className="jr-window-head">
        <span className="jr-window-k">◈ חלון פתוח</span>
        <span className="jr-window-count jr-n" dir="ltr">{w.done} / {w.of}</span>
      </div>
      <div className="jr-rail" role="presentation">
        <span className="jr-fill" style={{ width: `${w.of > 0 ? Math.min(100, (w.done / w.of) * 100) : 0}%` }} />
      </div>
      <p className="jr-what">{w.what}</p>
      {/* The trades behind the count. If the detector is picking the wrong
          ones, this is where the trader sees it — and they know their own
          trades better than any detector does. */}
      <EvidenceList kind={kind} />
    </div>
  );
}

function Result({ res }: { res: NonNullable<JourneyRow['result']> }) {
  return (
    <div className="jr-result">
      <div className="jr-result-top">
        <span className="jr-verdict" data-v={res.verdict}>{VERDICT_LABELS[res.verdict] ?? res.verdict}</span>
        <div className="jr-move">
          <span className="jr-move-k">לפני</span>
          <span className="jr-move-v" data-side="before">{res.before}%</span>
          <span className="jr-move-arrow" aria-hidden>←</span>
          <span className="jr-move-v" data-side="after">{res.after}%</span>
          <span className="jr-move-k">אחרי</span>
        </div>
      </div>

      {/* Both baselines. Agreeing is the entire test — a good fortnight and a
          changed habit look identical on the recent number alone. */}
      <div className="jr-baselines">
        <span className="jr-baseline" data-ok={res.historicalImproved}>
          <span className="jr-baseline-mark" aria-hidden>{res.historicalImproved ? '✓' : '✕'}</span>
          <span>מול כל ההיסטוריה</span>
        </span>
        <span className="jr-baseline" data-ok={res.rollingImproved}>
          <span className="jr-baseline-mark" aria-hidden>{res.rollingImproved ? '✓' : '✕'}</span>
          <span>מול התקופה האחרונה</span>
        </span>
      </div>

      {res.broken.length > 0 && (
        <div className="jr-broken">
          ההתנהגות אכן ירדה, אבל משהו אחר הורע במקביל: {res.broken.join(' · ')}.
          זו לא התקדמות — זו החלפה של בעיה אחת באחרת.
        </div>
      )}
    </div>
  );
}

/** Where this behaviour stands in the process. */
function Stepper({ status }: { status: string }) {
  const here = STATUS_ORDER.indexOf(status as typeof STATUS_ORDER[number]);
  return (
    <div className="jr-steps" aria-label="שלב בתהליך">
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

/* ── the trader's own problems ────────────────────────────────────────────── */

function MyRules({ rows, data }: { rows: JourneyRow[]; data: Journey }) {
  return (
    <section className="jr-band jr-sec" data-i="2" id="my-rules">
      <div className="jr-band-head">
        <h2 className="jr-band-q">מה שאתה בדקת על עצמך</h2>
        <span className="jr-band-cap">החוקים שכתבת</span>
      </div>

      {rows.length === 0 ? (
        <div className="jr-empty">
          <b>{data.hasRules ? 'לא סימנת עדיין הפרה של חוק' : 'עוד לא כתבת חוקים'}</b>
          {data.hasRules
            ? 'כשתסמן בטופס העסקה איזה חוק נשבר, הוא יופיע כאן עם הספירה שלו — כך בעיה שהיא שלך ולא אחת מהחמש מקבלת מעקב משלה.'
            : 'אם הבעיה שלך היא לא אחת מהחמש למעלה — כתוב אותה כחוק, וסמן בטופס העסקה כשהיא קורית. היא תופיע כאן עם ספירה ומכנה, בדיוק כמו השאר.'}
          <div style={{ marginTop: 14 }}>
            <Link href="/dashboard/rules" style={{ color: '#d4af37', fontWeight: 700 }}>לעמוד החוקים →</Link>
          </div>
        </div>
      ) : (
        <>
          {rows.map(r => (
            <div className="jr-row" data-stage="rule" key={r.kind}>
              <div className="jr-row-top">
                <span className="jr-status" data-source="rule">חוק שלך</span>
                <span className="jr-row-label">{r.label}</span>
                {r.opportunities > 0 && (
                  <span className="jr-row-count" dir="ltr">{r.occurrences} / {r.opportunities}</span>
                )}
              </div>
              <div className="jr-row-meta">
                {r.rate !== null && (
                  <span className="jr-meta">
                    <span className="jr-meta-k">שיעור</span>
                    <span className="jr-meta-v jr-n">{pct(r.rate)}</span>
                  </span>
                )}
                {r.lastSeenAt && (
                  <span className="jr-meta">
                    <span className="jr-meta-k">אחרונה</span>
                    <span className="jr-meta-v jr-n" dir="ltr">{day(r.lastSeenAt)}</span>
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* The honest limit of this section, stated where it is read. */}
          <p className="jr-note">
            הספירה היא מתוך {q(data.gradedTrades, 'העסקה האחת שבה ענית', 'העסקאות שבהן ענית')} על שאלת החוקים —
            אותו מספר לכל החוקים, כי השאלה נשאלת פעם אחת לעסקה.
            <br />
            השורות האלה נספרות ומוצגות, אבל הן לא עוברות את התהליך שלמעלה: לא מנסים לשנות אותן ואין
            עליהן תשובה סופית. הן מבוססות רק על מה שסימנת בעצמך, ולא נבדקו מול מספיק עסקאות שהיו
            יכולות להראות שזה לא באמת קורה.
          </p>
        </>
      )}
    </section>
  );
}
