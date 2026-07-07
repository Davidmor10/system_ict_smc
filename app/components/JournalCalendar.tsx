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

const usd = (n: number) => {
  const a = Math.abs(n).toLocaleString('en-US');
  return n > 0 ? '+$' + a : n < 0 ? '-$' + a : '$0';
};
const pnlColor = (n: number) => (n > 0 ? '#4a7c59' : n < 0 ? '#8b3a3a' : 'rgba(255,255,255,0.4)');

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

export default function JournalCalendar({
  trades,
  selectedDate,
  onSelectDate,
}: {
  trades: TradeEntry[];
  selectedDate: string | null;
  onSelectDate: (dateISO: string) => void;
}) {
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

  // « moves forward in time, » moves back — RTL reading order.
  function goForward() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); } else { setMonth(m => m + 1); }
  }
  function goBack() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); } else { setMonth(m => m - 1); }
  }

  return (
    <section dir="rtl">
      <div className="flex items-end justify-between mb-[22px] flex-wrap gap-4">
        <div>
          <div className="font-mono text-[11px] font-bold tracking-[0.28em] uppercase text-[#d4af37] mb-[9px]">MONTHLY P&amp;L</div>
          <h2 style={{ fontFamily: 'var(--serif)' }} className="text-[30px] font-bold text-white m-0">יומן רווחים חודשי</h2>
        </div>
        <div className="flex items-center gap-[22px]">
          <div className="flex items-center gap-7 pe-[22px] border-e border-[#1c1c1e]">
            {[
              { l: 'ימי מסחר', v: String(tradingDays), c: '#fff' },
              { l: 'עסקאות', v: String(monthTrades.length).padStart(2, '0'), c: '#fff' },
              { l: 'רווח כולל', v: monthTrades.length ? usd(totalPnl) : '—', c: pnlColor(totalPnl) },
            ].map(s => (
              <div key={s.l} className="text-center">
                <div className="text-[11px] text-white/40 mb-1">{s.l}</div>
                <div className="font-mono text-lg font-extrabold tabular-nums" style={{ color: s.c }}>{s.v}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={goForward}
              aria-label="חודש הבא"
              className="w-9 h-9 flex items-center justify-center rounded-sm border border-[#2a2a2d] bg-transparent text-white/55 hover:text-[#d4af37] hover:border-[#d4af37]/40 transition-colors font-mono text-base"
            >
              «
            </button>
            <span style={{ fontFamily: 'var(--serif)' }} className="min-w-[140px] text-center text-[22px] font-bold text-white">
              {MONTH_NAMES[month]} {year}
            </span>
            <button
              onClick={goBack}
              aria-label="חודש קודם"
              className="w-9 h-9 flex items-center justify-center rounded-sm border border-[#2a2a2d] bg-transparent text-white/55 hover:text-[#d4af37] hover:border-[#d4af37]/40 transition-colors font-mono text-base"
            >
              »
            </button>
          </div>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-8 gap-2 mb-2">
        {WEEKDAY_LABELS.map(label => (
          <div key={label} className="text-center text-xs font-semibold text-white/40 py-1">{label}</div>
        ))}
        <div className="text-center font-mono text-[10px] font-bold tracking-[0.1em] uppercase text-[#d4af37] py-1">סיכום שבועי</div>
      </div>

      <div className="flex flex-col gap-2">
        {weeks.map((week, wi) => {
          const weekPnl = week.reduce((sum, c) => sum + (c?.pnl ?? 0), 0);
          const weekCount = week.reduce((sum, c) => sum + (c?.count ?? 0), 0);
          return (
            <div key={wi} className="grid grid-cols-8 gap-2">
              {week.map((cell, ci) => {
                const isSel = !!cell && cell.dateISO === selectedDate;
                const isToday = !!cell && cell.dateISO === today;
                const hasTrades = !!cell && cell.count > 0;
                let bg = 'transparent';
                let border = 'transparent';
                if (cell) {
                  bg = '#0d0d0f';
                  border = '#1c1c1e';
                  if (hasTrades) {
                    bg = cell.pnl > 0
                      ? 'linear-gradient(150deg, rgba(74,124,89,0.2), rgba(13,13,15,0.4))'
                      : cell.pnl < 0
                        ? 'linear-gradient(150deg, rgba(139,58,58,0.2), rgba(13,13,15,0.4))'
                        : 'rgba(212,175,55,0.04)';
                  }
                  if (isSel) {
                    border = '#d4af37';
                    bg = cell.pnl > 0 ? 'rgba(74,124,89,0.3)' : cell.pnl < 0 ? 'rgba(139,58,58,0.3)' : 'rgba(212,175,55,0.1)';
                  } else if (isToday) {
                    border = 'rgba(212,175,55,0.45)';
                  }
                }
                return (
                  <div
                    key={ci}
                    onClick={hasTrades ? () => onSelectDate(cell!.dateISO) : undefined}
                    className="relative rounded-[10px] min-h-[112px] py-3 px-[13px] transition-[background,border-color] duration-200"
                    style={{ background: bg, border: `1px solid ${border}`, cursor: hasTrades ? 'pointer' : 'default' }}
                  >
                    {cell && (
                      <>
                        <div className="text-right font-mono text-sm font-bold tabular-nums" style={{ color: isToday ? '#d4af37' : 'rgba(255,255,255,0.7)' }}>{cell.day}</div>
                        {hasTrades && (
                          <div className="absolute bottom-3 start-[13px] end-[13px]">
                            <div className="font-mono text-lg font-extrabold tabular-nums" style={{ color: pnlColor(cell.pnl) }}>{usd(cell.pnl)}</div>
                            <div className="text-[11px] text-white/40 mt-0.5">{cell.count} עסקאות</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {/* Weekly summary column */}
              <div className="rounded-[10px] py-3 px-[13px] flex flex-col justify-center items-center text-center border border-[#1c1c1e]" style={{ background: 'linear-gradient(160deg, rgba(212,175,55,0.04), transparent)' }}>
                {weekCount > 0 ? (
                  <>
                    <div className="font-mono text-[17px] font-extrabold tabular-nums" style={{ color: pnlColor(weekPnl) }}>{usd(weekPnl)}</div>
                    <div className="text-[11px] text-white/40 mt-1">{weekCount} עסקאות</div>
                  </>
                ) : (
                  <span className="text-white/15 text-[10px]">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
