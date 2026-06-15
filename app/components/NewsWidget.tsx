import { getHighImpactUsdEvents } from '../lib/news';
import { getWeeklyRange } from '../lib/dateUtils';

// Async React Server Component — the high-impact USD macro feed is fetched,
// filtered and rendered on the server, so zero event data ships in the client
// bundle and there is no client-side hook. Because a Server Component re-renders
// on every request, `getWeeklyRange()` reads the system clock fresh each render:
// the feed self-updates to the current Mon–Fri window with no useEffect, no
// loading flash, and no hardcoded date.
// Classified institutional terminal aesthetic: monospace, uppercase, sharp.
export default async function NewsWidget() {
  const week = getWeeklyRange();
  const { status, groups } = await getHighImpactUsdEvents(week);

  return (
    <aside id="market-intel" className="w-72 shrink-0 flex flex-col border-r border-[#1c1c1e] bg-[#0d0d0f] overflow-y-auto scroll-mt-16">

      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-[#1c1c1e]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-white/80">
            Macro Feed
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">
            USD · High
          </span>
        </div>
        {/* Live current-week range, computed from the system clock each render. */}
        <span className="mt-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#d4af37]/70">
          {week.label}
          {week.rolledOverWeekend && (
            <span className="text-white/30"> · NEXT WEEK</span>
          )}
        </span>
      </div>

      {/* Feed */}
      <div className="flex flex-col">
        {status === 'unavailable' ? (
          <div className="px-5 py-6 flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500/80 shadow-[0_0_5px_rgba(245,158,11,0.5)] shrink-0" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
              Data unavailable
            </span>
          </div>
        ) : groups.length === 0 ? (
          <span className="px-5 py-6 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
            No high-impact USD events
          </span>
        ) : (
          groups.map((group) => (
            <section key={group.date}>
              {/* Day divider */}
              <div className="sticky top-0 z-10 px-5 py-2 bg-[#0d0d0f] border-b border-[#1c1c1e]">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#d4af37]">
                  {group.label}
                </span>
              </div>

              {group.events.map((event) => (
                <div
                  key={event.id}
                  className="px-5 py-3 border-b border-[#1c1c1e] last:border-0"
                >
                  {/* Time + impact cue */}
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-600/80 shadow-[0_0_5px_rgba(220,38,38,0.5)] shrink-0" />
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-white/80 tabular-nums">
                      {event.time}
                    </span>
                    <span className="ms-auto font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-white/30">
                      {event.currency}
                    </span>
                  </div>

                  {/* Event title */}
                  <span className="block font-mono text-xs font-bold uppercase tracking-[0.1em] text-white/80 leading-snug">
                    {event.title}
                  </span>

                  {/* Forecast / previous */}
                  {(event.forecast || event.previous) && (
                    <div className="flex items-center gap-4 mt-1.5">
                      {event.forecast && (
                        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/50">
                          F <span className="text-white/80">{event.forecast}</span>
                        </span>
                      )}
                      {event.previous && (
                        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/30">
                          P <span className="text-white/50">{event.previous}</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
