import { getHighImpactUsdEvents } from '../lib/news';
import { getWeeklyRange, addIsoDays } from '../lib/dateUtils';

// Async React Server Component — horizontal 5-column weekly macro board.
// Each column = one trading day (Mon–Fri), rendered even when empty.
// Today's column is highlighted with a gold border + tinted header.

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;

function buildWeekDays(startISO: string) {
  return DAY_LABELS.map((label, i) => {
    const iso = addIsoDays(startISO, i);
    const d = new Date(`${iso}T12:00:00Z`);
    const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
    return { iso, label, shortDate: `${month} ${d.getUTCDate()}` };
  });
}

export default async function NewsWidget() {
  const week = getWeeklyRange();
  const { status, groups } = await getHighImpactUsdEvents(week);

  // Today as YYYY-MM-DD (UTC noon, same convention as the rest of the engine)
  const today = new Date().toISOString().slice(0, 10);

  const weekDays = buildWeekDays(week.startISO);
  const eventsByDate = new Map(groups.map(g => [g.date, g.events]));

  return (
    <div>
      {/* Unavailable notice — shown above the grid, not instead of it */}
      {status === 'unavailable' && (
        <div className="flex items-center gap-2.5 mb-4">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500/80 [box-shadow:0_0_5px_rgba(245,158,11,0.5)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
            Feed unavailable — showing cached data
          </span>
        </div>
      )}

      <div className="grid grid-cols-5 gap-[14px] items-start">
        {weekDays.map(({ iso, label, shortDate }) => {
          const events = eventsByDate.get(iso) ?? [];
          const isToday = iso === today;

          return (
            <div
              key={iso}
              className={`rounded-[5px] overflow-hidden border ${
                isToday ? 'border-[#d4af37]/50' : 'border-[#1c1c1e]'
              } bg-[#0d0d0f]`}
            >
              {/* Day header */}
              <div className={`px-3 py-2.5 border-b border-[#1c1c1e] ${isToday ? 'bg-[rgba(212,175,55,0.06)]' : ''}`}>
                <div className={`font-mono text-[11px] font-bold tracking-[0.22em] ${isToday ? 'text-[#d4af37]' : 'text-white/55'}`}>
                  {label}
                </div>
                <div className={`font-mono text-[10px] mt-0.5 ${isToday ? 'text-[#d4af37]/60' : 'text-white/25'}`}>
                  {shortDate}
                </div>
              </div>

              {/* Events or empty state */}
              <div className="flex flex-col">
                {events.length === 0 ? (
                  <div className="flex items-center justify-center py-7">
                    <span className="font-mono text-[14px] text-white/15">—</span>
                  </div>
                ) : (
                  events.map(event => (
                    <div key={event.id} className="px-3 py-2.5 border-b border-[#1c1c1e] last:border-0">
                      {/* Time + currency row */}
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          event.impact === 'High'
                            ? 'bg-red-600/80 [box-shadow:0_0_5px_rgba(220,38,38,0.5)]'
                            : 'bg-[#d4af37]/70'
                        }`} />
                        <span className="font-mono text-[10px] font-bold text-white/65 tabular-nums">{event.time}</span>
                        <span className="ms-auto font-mono text-[9px] text-white/25">{event.currency}</span>
                      </div>
                      {/* Title */}
                      <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.07em] text-white/80 leading-snug">
                        {event.title}
                      </span>
                      {/* Forecast / previous */}
                      {(event.forecast || event.previous) && (
                        <div className="flex gap-3 mt-1">
                          {event.forecast && (
                            <span className="font-mono text-[9px] text-white/35">
                              F <span className="text-white/60">{event.forecast}</span>
                            </span>
                          )}
                          {event.previous && (
                            <span className="font-mono text-[9px] text-white/25">
                              P <span className="text-white/45">{event.previous}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
