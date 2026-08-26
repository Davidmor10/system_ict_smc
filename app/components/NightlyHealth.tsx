'use client';

import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// NightlyHealth — is the thing running.
//
// The nightly run produces every insight, advances every measurement window
// and, since the reconciler, repairs the mirror. It has written a record of
// itself since it shipped and nothing ever read it, so the failure mode was
// total silence: every screen kept rendering what the last good run produced,
// growing quietly staler, and the only symptom was the coach gradually having
// nothing new to say.
//
// One line, and it earns its space only by being specific: a date and a
// verdict. No chart, no history, no uptime percentage — the question is "did
// last night work", and dressing that up would make it easier to skim past.
//
// The repair counts sit under it because a run that reports "ok" while
// silently fixing rows every night is not healthy, it is a symptom being
// papered over.
// ─────────────────────────────────────────────────────────────────────────────

interface Health {
  lastRunAt: string | null;
  ok: boolean;
  durationMs: number | null;
  jobsCompleted: number;
  jobsFailed: number;
  repairedMissing: number | null;
  repairedGhosts: number | null;
  orphans: number | null;
}

/** How long ago, in the terms a person would use. */
function ago(iso: string): { text: string; stale: boolean } {
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(hours)) return { text: '—', stale: true };
  if (hours < 1)  return { text: 'לפני פחות משעה', stale: false };
  if (hours < 24) return { text: `לפני ${Math.round(hours)} שעות`, stale: false };
  const days = Math.round(hours / 24);
  // The cron runs daily, so anything past two days means runs are being missed
  // — which is exactly the state that used to be invisible.
  return { text: days === 1 ? 'אתמול' : `לפני ${days} ימים`, stale: days >= 2 };
}

const GOLD = '#d4af37';
const GREEN = '#6fa580';
const ROSE = '#c98080';

export default function NightlyHealth() {
  const [health, setHealth] = useState<Health | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetch('/api/system/health', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive) setHealth((j as Health) ?? null); })
      .catch(() => { if (alive) setHealth(null); });
    return () => { alive = false; };
  }, []);

  // Loading and unreachable both render nothing. A card that says "could not
  // check" is a third state the trader has to interpret, and the honest read
  // of it — "something is wrong somewhere" — is not information.
  if (health === undefined || health === null) return null;

  const when = health.lastRunAt ? ago(health.lastRunAt) : null;
  const failed = !health.ok || (when?.stale ?? true);
  const tone = failed ? ROSE : GREEN;

  const repairs = [
    health.repairedMissing ? `${health.repairedMissing} עסקאות הוחזרו לניתוח` : null,
    health.repairedGhosts  ? `${health.repairedGhosts} עסקאות מחוקות הופסקו להיספר` : null,
    health.orphans         ? `${health.orphans} שורות בלי מקור ביומן` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="rounded-[12px] border border-[#1c1c1e] bg-white/[0.02] p-5">
      <div className="font-mono text-[11px] font-bold tracking-[0.16em] uppercase text-white/60 mb-2">
        עיבוד לילי
      </div>

      {!health.lastRunAt ? (
        <div className="text-[15px]" style={{ color: ROSE }}>מעולם לא רץ</div>
      ) : (
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <span className="text-[15px] font-bold" style={{ color: tone }}>
            {health.ok ? 'הושלם' : 'נכשל'}
          </span>
          <span className="text-[13px] text-white/50">{when!.text}</span>
          {health.jobsFailed > 0 && (
            <span className="font-mono text-[11px] px-2 py-0.5 rounded-sm border"
              style={{ color: GOLD, borderColor: 'rgba(212,175,55,.35)', background: 'rgba(212,175,55,.08)' }}>
              {health.jobsFailed} משימות נכשלו
            </span>
          )}
        </div>
      )}

      <p className="text-[13px] text-white/50 mt-2 leading-relaxed">
        {failed
          ? 'התובנות, הדפוסים וחלונות המדידה מתעדכנים בעיבוד הזה. כל עוד הוא לא רץ, מה שאתה רואה במערכת הוא מהריצה האחרונה שהצליחה.'
          : 'התובנות, הדפוסים וחלונות המדידה מתעדכנים כל לילה.'}
      </p>

      {repairs.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 list-none p-0 m-0">
          {repairs.map(r => (
            <li key={r} className="text-[12.5px] text-white/45 flex items-baseline gap-2">
              <span style={{ color: GOLD }}>◇</span>{r}
            </li>
          ))}
        </ul>
      )}

      {/* Null, not zero: the run predates the reconciler or the database has
          not run its migration. Saying "0 repaired" there would be a claim
          nobody checked. */}
      {health.lastRunAt && health.repairedMissing === null && (
        <p className="text-[12px] text-white/30 mt-3">
          הריצה הזאת קדמה לבדיקת ההתאמה בין היומן למנוע.
        </p>
      )}
    </div>
  );
}

// ── exports for tests ───────────────────────────────────────────────────────
export const __testing = { ago };
