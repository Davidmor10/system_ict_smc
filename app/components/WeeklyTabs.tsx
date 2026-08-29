'use client';

import { useState } from 'react';
import WeeklyReportPanel from './WeeklyReportPanel';
import WeeklyBehaviorReview from './WeeklyBehaviorReview';

/** The week, in one card and two tabs.
 *
 *  Both panels cover the same seven days and answer different questions —
 *  what the RESULTS did, and whether anything about HOW you trade moved. That
 *  distinction is the reason both exist, so the tabs keep them strictly apart
 *  rather than interleaving them into one narrative: a paragraph that mixes
 *  "you made $1,400" with "you stopped widening stops" teaches the reader that
 *  the second caused the first, which is exactly the claim neither panel is
 *  allowed to make.
 *
 *  Stacked, they read as the same thing said twice and cost two screenfuls.
 *  One at a time, the reader picks the question. */
const TABS = [
  { key: 'results',  label: 'תוצאות השבוע' },
  { key: 'behavior', label: 'התנהגות ומשמעת' },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function WeeklyTabs({ hasEnoughData, isoWeekKey, todayISO, fingerprint, closedThisWeek }: {
  hasEnoughData: boolean;
  /** Closed trades in the current week — the results panel needs it to know
   *  which empty state to show when there is no report. */
  closedThisWeek: number;
  isoWeekKey: (dateISO: string) => string;
  todayISO: () => string;
  fingerprint: string;
}) {
  const [tab, setTab] = useState<TabKey>('results');

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-6 flex-wrap" role="tablist">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`py-2 px-[15px] rounded-sm border font-mono text-[11px] font-bold tracking-[0.14em] uppercase transition-all duration-300 ${
              tab === t.key
                ? 'border-[#d4af37]/50 bg-[#d4af37]/10 text-[#d4af37]'
                : 'border-[#1c1c1e] text-white/40 hover:text-white/70 hover:border-[#2a2a2d]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Both stay mounted-on-demand rather than hidden: each fetches its own
          week, and a panel that loads only when its tab is opened is one fewer
          request for a reader who never opens it. */}
      {tab === 'results'
        ? <WeeklyReportPanel hasEnoughData={hasEnoughData} isoWeekKey={isoWeekKey} todayISO={todayISO} fingerprint={fingerprint} closedThisWeek={closedThisWeek} />
        : <WeeklyBehaviorReview />}
    </div>
  );
}
