'use client';

import { useEffect, useState } from 'react';

/** Every window that has closed, and what it came to.
 *
 *  The point of keeping this is the honest verdict, which the engine already
 *  produces and nothing displayed: `traded_one_problem_for_another` — the
 *  target improved AND something being protected got worse. A review that only
 *  ever reports improvements is a review nobody learns anything from, and this
 *  is the one place the system says "that went sideways" out loud. */
interface Past {
  label: string;
  verdict: string;
  before: number;
  after: number;
  broken: string[];
}

const VERDICT: Record<string, { he: string; color: string; bg: string; bd: string }> = {
  improved:                       { he: 'השתפר',                  color: '#6fa580', bg: 'rgba(74,124,89,.1)',  bd: 'rgba(74,124,89,.4)' },
  traded_one_problem_for_another: { he: 'החלפת בעיה בבעיה',       color: '#d4af37', bg: 'rgba(212,175,55,.1)', bd: 'rgba(212,175,55,.4)' },
  unchanged:                      { he: 'ללא שינוי',              color: 'rgba(255,255,255,.5)', bg: 'rgba(255,255,255,.03)', bd: '#2a2a2d' },
  insufficient_data:              { he: 'החלון לא התמלא',         color: 'rgba(255,255,255,.4)', bg: 'rgba(255,255,255,.03)', bd: '#2a2a2d' },
};

const GUARDRAIL_HE: Record<string, string> = {
  trade_frequency: 'מספר עסקאות',
  avg_loss_r:      'גודל הפסד ממוצע',
  logging_rate:    'שלמות התיעוד',
  rule_adherence:  'עמידה בחוקים',
};

export default function TrackingArchive() {
  const [past, setPast] = useState<Past[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/coach/tracking', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) setPast(Array.isArray(d?.past) ? d.past : []); })
      .catch(() => { if (alive) setPast([]); });
    return () => { alive = false; };
  }, []);

  if (past === null) return null;
  if (past.length === 0) {
    return (
      <p className="text-sm text-white/40 py-2 leading-relaxed" style={{ maxWidth: '62ch' }}>
        עדיין לא נסגר כאן אף מעקב, וזה לוקח זמן בכוונה. הסדר הוא כזה: הריצה הלילית מזהה התנהגות שחוזרת על עצמה,
        בלילה שאחריו היא פותחת עליה חלון מדידה, ואז נדרשות עוד עשר הזדמנויות בעסקאות שלך עד שאפשר לומר משהו.
        כלומר אי אפשר למלא את המקום הזה בהזנת עסקאות היום — צריך כמה לילות ועוד עסקאות אחריהם.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-px bg-[#1c1c1e] border border-[#1c1c1e] rounded-[4px] overflow-hidden">
      {past.map((p, i) => {
        const v = VERDICT[p.verdict] ?? VERDICT.unchanged;
        return (
          <div key={i} className="bg-[#0a0a0b] p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <span className="font-mono text-[10px] font-bold tracking-[0.14em] px-2 py-1 rounded-sm border"
                style={{ color: v.color, borderColor: v.bd, background: v.bg }}>
                {v.he}
              </span>
              <span className="font-mono text-sm font-bold text-white">{p.label}</span>
            </div>

            <div className="flex items-center gap-3 flex-wrap font-mono text-[12px]" dir="ltr">
              <span className="text-white/40 tabular-nums">{p.before}%</span>
              <span className="text-white/25">→</span>
              <span className="tabular-nums font-bold" style={{ color: p.after < p.before ? '#6fa580' : '#c98080' }}>
                {p.after}%
              </span>
            </div>

            {p.broken.length > 0 && (
              <p className="text-[12.5px] leading-relaxed text-[#d4af37]/80">
                בזמן שזה השתפר, זה נחלש: {p.broken.map(b => GUARDRAIL_HE[b] ?? b).join(' · ')}.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
