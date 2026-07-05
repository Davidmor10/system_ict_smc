'use client';

import { useMemo, useState } from 'react';
import type { TradeEntry } from '../lib/journal';
import { tradePnL, todayISO } from '../lib/journal';

const MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];
const WEEKDAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

interface DayCell {
  day: number;
  dateISO: string;
  pnl: number;
  count: number;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function buildWeeks(year: number, month: number, trades: TradeEntry[]): (DayCell | null)[][] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();

  const pnlByDay = new Map<string, { pnl: number; count: number }>();
  for (const t of trades) {
    if (t.dateISO.slice(0, 7) !== `${year}-${pad(month + 1)}`) continue;
    const pnl = tradePnL(t);
    if (pnl === null) continue;
    const cur = pnlByDay.get(t.dateISO) ?? { pnl: 0, count: 0 };
    cur.pnl += pnl;
    cur.count += 1;
    pnlByDay.set(t.dateISO, cur);
  }

  const cells: (DayCell | null)[] = Array(firstWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateISO = `${year}-${pad(month + 1)}-${pad(d)}`;
    const agg = pnlByDay.get(dateISO);
    cells.push({ day: d, dateISO, pnl: agg?.pnl ?? 0, count: agg?.count ?? 0 });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (DayCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export default function JournalCalendar({ trades }: { trades: TradeEntry[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const weeks = useMemo(() => buildWeeks(year, month, trades), [year, month, trades]);
  const today = todayISO();

  const monthTrades = useMemo(
    () => trades.filter(t => t.dateISO.slice(0, 7) === `${year}-${pad(month + 1)}`),
    [trades, year, month],
  );
  const tradingDays = new Set(monthTrades.map(t => t.dateISO)).size;
  const totalPnl = monthTrades.reduce((sum, t) => sum + (tradePnL(t) ?? 0), 0);

  function goPrev() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); } else { setMonth(m => m - 1); }
  }
  function goNext() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); } else { setMonth(m => m + 1); }
  }

  return (
    <div className="rounded-2xl bg-[#0a0a0b] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]" dir="rtl">
      {/* Header: month nav + month stats */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={goNext}
            aria-label="חודש הבא"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#1c1c1e] text-white/60 hover:text-[#d4af37] transition-colors"
          >
            »
          </button>
          <span className="font-serif text-xl text-white min-w-[120px] text-center">
            {year} {MONTH_NAMES[month]}
          </span>
          <button
            onClick={goPrev}
            aria-label="חודש קודם"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#1c1c1e] text-white/60 hover:text-[#d4af37] transition-colors"
          >
            «
          </button>
        </div>
        <div className="flex items-center gap-6 font-mono text-xs">
          <div className="text-center">
            <div className="text-white/30 uppercase tracking-[0.14em] text-[10px]">ימי מסחר</div>
            <div className="text-white/90 mt-0.5">{tradingDays}</div>
          </div>
          <div className="text-center">
            <div className="text-white/30 uppercase tracking-[0.14em] text-[10px]">סה&quot;כ עסקאות</div>
            <div className="text-white/90 mt-0.5">{monthTrades.length}</div>
          </div>
          <div className="text-center">
            <div className="text-white/30 uppercase tracking-[0.14em] text-[10px]">רווח ותפסד כולל</div>
            <div className={`mt-0.5 ${totalPnl > 0 ? 'text-[#22c55e]' : totalPnl < 0 ? 'text-[#ef4444]' : 'text-white/90'}`}>
              {totalPnl >= 0 ? '+' : '-'}${Math.abs(totalPnl).toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Weekday header row */}
      <div className="grid grid-cols-8 gap-1.5 mb-1.5">
        {WEEKDAY_LABELS.map(label => (
          <div key={label} className="text-center font-mono text-[10px] uppercase tracking-[0.1em] text-white/30 py-1">
            {label}
          </div>
        ))}
        <div className="text-center font-mono text-[10px] uppercase tracking-[0.1em] text-white/30 py-1">
          סיכום שבועי
        </div>
      </div>

      {/* Weeks */}
      <div className="flex flex-col gap-1.5">
        {weeks.map((week, wi) => {
          const weekPnl = week.reduce((sum, c) => sum + (c?.pnl ?? 0), 0);
          const weekCount = week.reduce((sum, c) => sum + (c?.count ?? 0), 0);
          return (
            <div key={wi} className="grid grid-cols-8 gap-1.5">
              {week.map((cell, ci) => (
                <div
                  key={ci}
                  className={`rounded-lg p-2 min-h-[72px] flex flex-col justify-between ${
                    cell ? 'bg-black/40' : 'bg-transparent'
                  } ${cell?.dateISO === today ? 'ring-1 ring-[#d4af37]/50' : ''}`}
                >
                  {cell && (
                    <>
                      <span className="font-mono text-xs text-white/40 self-end">{cell.day}</span>
                      {cell.count > 0 && (
                        <div className="text-right">
                          <div className={`font-mono text-sm ${cell.pnl >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                            {cell.pnl >= 0 ? '+' : '-'}${Math.abs(cell.pnl).toFixed(0)}
                          </div>
                          <div className="font-mono text-[9px] text-white/30">{cell.count} עסקאות</div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
              {/* Weekly summary column */}
              <div className="rounded-lg p-2 min-h-[72px] flex flex-col justify-center items-center bg-[#1c1c1e]/40">
                {weekCount > 0 ? (
                  <>
                    <div className={`font-mono text-sm ${weekPnl >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                      {weekPnl >= 0 ? '+' : '-'}${Math.abs(weekPnl).toFixed(0)}
                    </div>
                    <div className="font-mono text-[9px] text-white/30">{weekCount} עסקאות</div>
                  </>
                ) : (
                  <span className="font-mono text-[10px] text-white/15">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
