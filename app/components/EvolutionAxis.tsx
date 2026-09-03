'use client';

import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// The edge hypothesis, week by week.
//
// Consecutive weeks holding the same hypothesis are condensed into one range
// upstream, so this reads as "this was the edge from here to here" rather than
// as a list repeating itself.
//
// A week with no clear edge is printed as one, not omitted. Dropping it would
// turn a broken run of confident weeks into a smooth one, which is the shape
// of a trader's history most worth being honest about.
// ─────────────────────────────────────────────────────────────────────────────

interface Entry {
  fromIsoWeek: string; toIsoWeek: string; description: string | null; status: string;
}

export default function EvolutionAxis() {
  const [rows, setRows] = useState<Entry[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/ai/evolution', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive) setRows((j?.evolution as Entry[]) ?? []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);

  if (rows === null) return <div className="text-white/30 text-sm">טוען…</div>;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#2a2a2d] bg-[#0d0d0f] p-6 text-sm leading-7 text-white/40">
        <b className="block text-white/60 text-[15px] mb-1.5">אין עדיין ציר התפתחות</b>
        הציר נבנה מהדוחות השבועיים. אחרי כמה שבועות של תיעוד תראה כאן איך ההשערה על היתרון שלך
        השתנתה — ומתי לא היה יתרון ברור.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#1c1c1e] bg-[#0d0d0f] px-6 py-2">
      {rows.map(e => (
        <div key={`${e.fromIsoWeek}-${e.toIsoWeek}`} className="flex gap-4 border-t border-[#1c1c1e] py-4 first:border-t-0">
          <div className="min-w-[104px] shrink-0 pt-0.5 font-mono text-[11px] font-bold text-[#d4af37]" dir="ltr">
            {e.fromIsoWeek === e.toIsoWeek ? e.fromIsoWeek : `${e.fromIsoWeek} → ${e.toIsoWeek}`}
          </div>
          <div className={`flex-1 text-[14.5px] leading-7 ${e.description ? 'text-white/85' : 'text-white/35'}`}>
            {e.description ?? 'לא זוהה יתרון ברור בתקופה הזו.'}
          </div>
        </div>
      ))}
    </div>
  );
}
