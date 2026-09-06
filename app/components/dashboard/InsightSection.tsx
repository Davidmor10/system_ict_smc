'use client';

// ─────────────────────────────────────────────────────────────────────────────
// The daily note, and the rail beside it.
//
// One panel, two columns: the coach's checks on the right (236px, first in
// source order so RTL puts it there) and the note itself on the left.
//
// It replaces DailyInsightCard + CoachReadiness as two stacked cards. Same
// endpoints, same POSTs, same contract — what changed is that the readiness
// list is no longer a footer under the note but a standing rail beside it,
// which is what the handoff specifies and also what it is for: the note says
// what the coach found today, the rail says what it can see at all.
//
// EVERY ENDPOINT FAILURE IS SILENT AND PARTIAL. The rail renders without the
// note and the note without the rail; neither takes the panel down with it.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { DailyInsightRow, UserReaction } from '../../lib/coach-pipeline/types';
import { activeZone } from '../../lib/time/zone';
import { renderInsightMarkdown } from '../dailyInsightMarkdown';

interface Detector { kind: string; label: string; state: 'ready' | 'partial' | 'blocked'; have: number; need: number; action: string; }
interface Readiness { tradesTotal: number; tradesDecided: number; detectors: Detector[]; readyCount: number; }
interface OpenQuestion { kind: string; question: string; }

const VOTES: Array<{ key: UserReaction; label: string }> = [
  { key: 'helpful',     label: 'עוזר' },
  { key: 'meh',         label: 'ככה־ככה' },
  { key: 'not_helpful', label: 'לא עוזר' },
];

function todayIsoInZone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: activeZone(), year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** "אתמול · 4 בספטמבר" — the note is written overnight, so yesterday is the
 *  ordinary case and saying so beats a bare date the reader has to convert. */
function relativeDate(dateIso: string, today: string): string {
  if (dateIso === today) return 'היום';
  const label = new Date(`${dateIso}T12:00:00Z`)
    .toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  return dateIso === y.toISOString().slice(0, 10) ? `אתמול · ${label}` : label;
}

export default function InsightSection({ locked }: { locked: boolean }) {
  const [insight, setInsight] = useState<DailyInsightRow | null | undefined>(undefined);
  const [question, setQuestion] = useState<OpenQuestion | null>(null);
  const [primaryKind, setPrimaryKind] = useState<string | null>(null);
  const [reaction, setReaction] = useState<UserReaction | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [draft, setDraft] = useState('');
  const [answerState, setAnswerState] = useState<'idle' | 'sending' | 'saved' | 'failed'>('idle');
  const readSent = useRef(false);

  useEffect(() => {
    if (locked) return;
    let alive = true;

    fetch('/api/coach/daily-insight', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!alive) return;
        const row = (j?.insight ?? null) as DailyInsightRow | null;
        setInsight(row);
        setReaction(row?.user_reaction ?? null);
        setQuestion((j?.openQuestion ?? null) as OpenQuestion | null);
        setPrimaryKind((j?.primaryKind ?? null) as string | null);
      })
      .catch(() => { if (alive) setInsight(null); });

    fetch('/api/coach/readiness', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive) setReadiness((j?.readiness ?? null) as Readiness | null); })
      .catch(() => { /* the note stands on its own */ });

    return () => { alive = false; };
  }, [locked]);

  // Mark read on the first successful view — one POST, one time.
  useEffect(() => {
    if (!insight || readSent.current || insight.read_at) return;
    readSent.current = true;
    fetch('/api/coach/daily-insight/read', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: insight.id }),
    }).catch(() => { readSent.current = false; });
  }, [insight]);

  const react = useCallback((next: UserReaction) => {
    if (!insight) return;
    const prev = reaction;
    setReaction(next);                       // optimistic
    fetch('/api/coach/daily-insight/reaction', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: insight.id, reaction: next }),
    }).catch(() => setReaction(prev));        // roll back on failure
  }, [insight, reaction]);

  /** Not optimistic, unlike the vote. A reaction that silently fails costs a
   *  thumb; an answer that silently fails costs the trader a minute of writing
   *  they would never know had been lost. */
  const sendAnswer = useCallback(() => {
    const text = draft.trim();
    if (!question || !text || answerState === 'sending') return;
    setAnswerState('sending');
    fetch('/api/coach/daily-insight/answer', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: question.kind, answer: text }),
    })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); setAnswerState('saved'); })
      .catch(() => setAnswerState('failed'));
  }, [draft, question, answerState]);

  const today = useMemo(() => todayIsoInZone(), []);
  const html = useMemo(() => (insight ? renderInsightMarkdown(insight.content_md) : ''), [insight]);

  const checks = readiness?.detectors ?? [];
  const readyOf = readiness ? `${readiness.readyCount} מתוך ${readiness.detectors.length} בדיקות פעילות` : null;

  return (
    <section className="dsh-insight" data-reveal="1" aria-label="תובנת AI">
      <div className="dsh-bloom is-insight" aria-hidden />

      {/* ── the rail ─────────────────────────────────────────────── */}
      <aside className="dsh-rail">
        <div className="dsh-h">מה המאמן רואה</div>
        {readyOf && <div className="dsh-rail-sub">{readyOf}</div>}

        <div className="dsh-checks">
          {checks.map(d => (
            <div className="dsh-check" key={d.kind}>
              <span className="dsh-check-n dsh-ltr">{d.have}</span>
              <span className="dsh-check-l">{d.label}</span>
            </div>
          ))}
        </div>

        <p className="dsh-rail-foot">
          המאמן שותק עד שיש מספיק כדי לומר משהו נכון. זה מה שחסר לו — לא כמה זמן לחכות.
        </p>

        {insight && (
          <div className="dsh-rail-bottom">
            <span className="dsh-rail-ask">עזר? זה עוזר לנו לכייל את המאמן.</span>
            <div className="dsh-votes" role="group" aria-label="משוב">
              {VOTES.map(v => (
                <button
                  key={v.key} type="button" className="dsh-vote"
                  aria-pressed={reaction === v.key}
                  onClick={() => react(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* ── the note ─────────────────────────────────────────────── */}
      <div className="dsh-note">
        <div className="dsh-note-head">
          <span className="dsh-h"><span className="dsh-h-dot" />תובנת AI · יומית</span>
          {insight && <span className="dsh-note-date dsh-ltr">{relativeDate(insight.date, today)}</span>}
        </div>

        {locked ? (
          <div className="dsh-locked">
            <div className="dsh-locked-k">הניתוח נעול במסלול שלך</div>
            <div className="dsh-locked-m">תובנה יומית, מעקב אחרי הרגלים וזיהוי דפוסים — במסלול <b>PRO ומעלה</b></div>
            <div className="dsh-locked-n">המערכת מתחילה לנתח את העסקאות שלך מהלילה שבו תשדרג — לא לפני.</div>
            <Link href="/checkout" className="dsh-locked-cta">שדרוג ל־PRO ←</Link>
          </div>
        ) : insight === undefined ? (
          <div className="dsh-skel" aria-busy="true">
            <span style={{ width: '40%' }} /><span style={{ width: '86%' }} /><span style={{ width: '64%' }} />
          </div>
        ) : !insight ? (
          <div className="dsh-note-body">
            <p>האינסייט הראשון שלך בדרך.</p>
            <p>ברגע שהמסחר של היום יסתיים, המאמן ינסח כאן את התובנה שלו — פעם ביום בבוקר. הרשימה מימין היא מה שהוא כבר רואה.</p>
          </div>
        ) : (
          <>
            {/* Server-generated markdown, escaped then transformed by our own
                inlineFormat pipeline — nothing here comes from the model raw. */}
            <div className="dsh-note-body" dangerouslySetInnerHTML={{ __html: html }} />

            {question && (
              <>
                <div className="dsh-ask">
                  <div className="dsh-ask-k"><span>◈</span>מה ONYX מבקש שתבדוק</div>
                  <p className="dsh-ask-q">{question.question}</p>
                </div>

                <div className="dsh-answer">
                  <div className="dsh-answer-k">התשובה שלך</div>
                  {answerState === 'saved' ? (
                    <p className="dsh-answer-saved">✓ נשמר. זה ייכנס לניתוח.</p>
                  ) : (
                    <>
                      <textarea
                        className="dsh-answer-in" rows={3} maxLength={2000}
                        value={draft} placeholder={question.question}
                        aria-label="התשובה שלך"
                        disabled={answerState === 'sending'}
                        onChange={e => { setDraft(e.target.value); if (answerState === 'failed') setAnswerState('idle'); }}
                      />
                      <div className="dsh-answer-foot">
                        <button
                          type="button" className="dsh-btn is-sm"
                          onClick={sendAnswer}
                          disabled={!draft.trim() || answerState === 'sending'}
                        >
                          שלח
                        </button>
                        <span className="dsh-answer-why">
                          {answerState === 'failed'
                            ? 'לא נשמר. נסה שוב.'
                            : 'כל השאר מחושב מהעסקאות שלך. זה הדבר היחיד שרק אתה יכול לספר — ובלעדיו הניתוח לא יכול להתחזק.'}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {/* Every claim the coach makes has to be openable. The day it is
                wrong — and it will be — the difference between a system the
                trader corrects and one they stop believing is whether they can
                see the trades it counted. */}
            {primaryKind && (
              <div className="dsh-note-link">
                <Link href={`/dashboard/progress#${primaryKind}`}>הצג את העסקאות שמאחורי המספר ←</Link>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
