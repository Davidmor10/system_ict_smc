'use client';

import './DailyInsightCard.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import type { DailyInsightRow, UserReaction } from '../lib/coach-pipeline/types';
import { renderInsightMarkdown } from './dailyInsightMarkdown';

// ─────────────────────────────────────────────────────────────────────────────
// DailyInsightCard — renders the newest daily_insights row for the signed-in
// user. Self-contained: fetches its own data, marks itself read on first view,
// posts reactions back to the server. Zero props required.
//
// Backend contract (all set up in earlier steps — nothing new here):
//   GET  /api/coach/daily-insight          → { insight: DailyInsightRow | null }
//   POST /api/coach/daily-insight/read     → body { id }
//   POST /api/coach/daily-insight/reaction → body { id, reaction }
// ─────────────────────────────────────────────────────────────────────────────

// ── Localized labels ───────────────────────────────────────────────────────
const STR = {
  he: {
    eyebrow:      'תובנת AI · יומית',
    fastBadge:    '⚡ אינסייט מהיר',
    newBadge:     'חדש',
    emptyTitle:   'האינסייט הראשון שלך בדרך',
    emptyBody:    'ברגע שהמסחר של היום יסתיים, המאמן ינסח כאן את התובנה שלו — פעם ביום בבוקר.',
    errorTitle:   'לא הצלחנו לטעון את האינסייט',
    errorBody:    'זו בעיה זמנית. רענן את הדף בעוד רגע.',
    hint:         'עוזר? זה עוזר לנו לכייל את המאמן.',
    helpful:      'עוזר',
    meh:          'ככה־ככה',
    notHelpful:   'לא עוזר',
    dateRel: (dateIso: string, today: string) => {
      if (dateIso === today) return 'היום';
      const d = new Date(`${dateIso}T12:00:00Z`);
      return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
    },
  },
  en: {
    eyebrow:      'AI INSIGHT · DAILY',
    fastBadge:    '⚡ Fast insight',
    newBadge:     'NEW',
    emptyTitle:   'Your first insight is on the way',
    emptyBody:    "Once today's trading wraps, the coach will write its observation here — once a day, in the morning.",
    errorTitle:   "Couldn't load your insight",
    errorBody:    'This is temporary. Refresh in a moment.',
    hint:         'Helpful? It tunes the coach.',
    helpful:      'Helpful',
    meh:          'Meh',
    notHelpful:   'Not helpful',
    dateRel: (dateIso: string, today: string) => {
      if (dateIso === today) return 'Today';
      const d = new Date(`${dateIso}T12:00:00Z`);
      return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long' });
    },
  },
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────
function todayIsoIsrael(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

// ── Component ──────────────────────────────────────────────────────────────
export default function DailyInsightCard() {
  const { lang } = useLanguage();
  const t = STR[lang as 'he' | 'en'] ?? STR.he;

  const [insight, setInsight]   = useState<DailyInsightRow | null | undefined>(undefined); // undefined = loading
  const [error, setError]       = useState(false);
  const [reaction, setReaction] = useState<UserReaction | null>(null);
  const readSent = useRef(false);

  // Fetch on mount.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/coach/daily-insight', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(j => {
        if (cancelled) return;
        const row = (j?.insight ?? null) as DailyInsightRow | null;
        setInsight(row);
        setReaction(row?.user_reaction ?? null);
      })
      .catch(() => { if (!cancelled) { setError(true); setInsight(null); } });
    return () => { cancelled = true; };
  }, []);

  // Mark read on first successful view — one POST, one time.
  useEffect(() => {
    if (!insight || readSent.current || insight.read_at) return;
    readSent.current = true;
    fetch('/api/coach/daily-insight/read', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: insight.id }),
    }).catch(() => { readSent.current = false; });
  }, [insight]);

  const react = useCallback((next: UserReaction) => {
    if (!insight) return;
    const prev = reaction;
    setReaction(next);   // optimistic
    fetch('/api/coach/daily-insight/reaction', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: insight.id, reaction: next }),
    }).catch(() => setReaction(prev));   // roll back on failure
  }, [insight, reaction]);

  const today = useMemo(() => todayIsoIsrael(), []);
  const html  = useMemo(() => insight ? renderInsightMarkdown(insight.content_md) : '', [insight]);

  // ── Loading skeleton ── */
  if (insight === undefined) {
    return (
      <div className="di-skel" aria-busy="true">
        <div className="di-skel-line w40" />
        <div className="di-skel-line w80" />
        <div className="di-skel-line w60" />
      </div>
    );
  }

  // ── Error state ── */
  if (error) {
    return (
      <div className="di-error" role="alert">
        <div className="di-error-title">{t.errorTitle}</div>
        <p className="di-error-body">{t.errorBody}</p>
      </div>
    );
  }

  // ── Empty state (no insight yet) ── */
  if (!insight) {
    return (
      <div className="di-empty">
        <div className="di-error-title">{t.emptyTitle}</div>
        <p className="di-empty-body">{t.emptyBody}</p>
      </div>
    );
  }

  // ── Insight card ── */
  const isUnread = !insight.read_at;

  return (
    <article className="di-card" dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <header className="di-head">
        <span className="di-eyebrow">
          <span className="di-eyebrow-dot" />
          {t.eyebrow}
          {isUnread && <span className="di-new-dot" aria-label={t.newBadge} title={t.newBadge} />}
        </span>
        <span className="di-head-right">
          {insight.fallback_used && (
            <span className="di-fast-badge" title={insight.fallback_reason ?? undefined}>
              {t.fastBadge}
            </span>
          )}
          <span className="di-date" dir="ltr">{t.dateRel(insight.date, today)}</span>
        </span>
      </header>

      {/* The markdown is server-generated + escape-then-transform on the client,
          so dangerouslySetInnerHTML here only receives strings we produced from
          our own inlineFormat pipeline. */}
      <div className="di-body" dangerouslySetInnerHTML={{ __html: html }} />

      <footer className="di-foot">
        <span className="di-foot-hint">{t.hint}</span>
        <div className="di-reactions" role="group" aria-label="feedback">
          <button
            type="button" className="di-react" data-kind="helpful"
            data-active={reaction === 'helpful'}
            onClick={() => react('helpful')}
          >
            👍 {t.helpful}
          </button>
          <button
            type="button" className="di-react" data-kind="meh"
            data-active={reaction === 'meh'}
            onClick={() => react('meh')}
          >
            😐 {t.meh}
          </button>
          <button
            type="button" className="di-react" data-kind="not_helpful"
            data-active={reaction === 'not_helpful'}
            onClick={() => react('not_helpful')}
          >
            👎 {t.notHelpful}
          </button>
        </div>
      </footer>
    </article>
  );
}
