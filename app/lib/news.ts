// ─────────────────────────────────────────────────────────────────────────────
// Macro Data Engine — economic calendar utility.
// Mirrors the Forex Factory / Investing.com event model. The public API exposes
// ONLY the high-impact USD feed, grouped chronologically, for the macro terminal.
// ─────────────────────────────────────────────────────────────────────────────

export type Impact = 'High' | 'Medium' | 'Low';

export type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD' | 'CHF' | 'CNY';

/** A single scheduled macro event, as a calendar feed would deliver it. */
export interface EconomicEvent {
  id: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  /** 24h time in US Eastern, `HH:mm`, or a marker like `'All Day'` / `'Tentative'`. */
  time: string;
  currency: Currency;
  impact: Impact;
  title: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
}

/** Filtered events bucketed under a single calendar day. */
export interface EventGroup {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  /** Display label, e.g. `WED · JUN 11`. */
  label: string;
  events: EconomicEvent[];
}

// ── Raw feed (mock) ──────────────────────────────────────────────────────────
// Stand-in for a live calendar API response. Deliberately mixes currencies and
// impact levels so the filter below has something real to strip out.
const RAW_FEED: EconomicEvent[] = [
  { id: 'evt-01', date: '2026-06-10', time: '08:30', currency: 'USD', impact: 'High',   title: 'Core CPI m/m',                forecast: '0.3%',  previous: '0.2%',  actual: null },
  { id: 'evt-02', date: '2026-06-10', time: '08:30', currency: 'USD', impact: 'High',   title: 'CPI y/y',                     forecast: '3.1%',  previous: '3.4%',  actual: null },
  { id: 'evt-03', date: '2026-06-10', time: '10:30', currency: 'USD', impact: 'Medium', title: 'Crude Oil Inventories',       forecast: '-1.2M', previous: '0.6M',  actual: null },
  { id: 'evt-04', date: '2026-06-10', time: '07:00', currency: 'GBP', impact: 'High',   title: 'BOE Gov Bailey Speaks',       forecast: null,    previous: null,    actual: null },
  { id: 'evt-05', date: '2026-06-11', time: '14:00', currency: 'USD', impact: 'High',   title: 'FOMC Statement',              forecast: null,    previous: null,    actual: null },
  { id: 'evt-06', date: '2026-06-11', time: '14:00', currency: 'USD', impact: 'High',   title: 'Federal Funds Rate',          forecast: '<5.50%', previous: '5.50%', actual: null },
  { id: 'evt-07', date: '2026-06-11', time: '14:30', currency: 'USD', impact: 'High',   title: 'FOMC Press Conference',       forecast: null,    previous: null,    actual: null },
  { id: 'evt-08', date: '2026-06-11', time: '08:30', currency: 'USD', impact: 'Medium', title: 'PPI m/m',                     forecast: '0.1%',  previous: '0.5%',  actual: null },
  { id: 'evt-09', date: '2026-06-11', time: 'All Day', currency: 'EUR', impact: 'Low',  title: 'German Bank Holiday',         forecast: null,    previous: null,    actual: null },
  { id: 'evt-10', date: '2026-06-12', time: '08:30', currency: 'USD', impact: 'High',   title: 'Unemployment Claims',         forecast: '224K',  previous: '215K',  actual: null },
  { id: 'evt-11', date: '2026-06-12', time: '08:30', currency: 'USD', impact: 'Medium', title: 'Retail Sales m/m',            forecast: '0.3%',  previous: '0.1%',  actual: null },
  { id: 'evt-12', date: '2026-06-12', time: '02:00', currency: 'JPY', impact: 'High',   title: 'BOJ Policy Rate',             forecast: '0.50%', previous: '0.50%', actual: null },
  { id: 'evt-13', date: '2026-06-13', time: '10:00', currency: 'USD', impact: 'High',   title: 'Prelim UoM Consumer Sentiment', forecast: '73.1', previous: '74.0', actual: null },
  { id: 'evt-14', date: '2026-06-13', time: '08:30', currency: 'CAD', impact: 'Medium', title: 'Manufacturing Sales m/m',     forecast: '0.4%',  previous: '-0.3%', actual: null },
];

// ── Filtering ────────────────────────────────────────────────────────────────

/**
 * STRICT FILTER — the engine surfaces an event only when BOTH hold:
 *   • currency === 'USD'
 *   • impact   === 'High'   (red folder / 3-star)
 * Everything else is dropped at the source.
 */
function isTradeable(event: EconomicEvent): boolean {
  return event.currency === 'USD' && event.impact === 'High';
}

/** Sort by time of day; non-clock markers (`All Day`, `Tentative`) sink to the bottom. */
function byTime(a: EconomicEvent, b: EconomicEvent): number {
  const clock = /^\d{2}:\d{2}$/;
  const aClock = clock.test(a.time);
  const bClock = clock.test(b.time);
  if (aClock && bClock) return a.time.localeCompare(b.time);
  if (aClock) return -1;
  if (bClock) return 1;
  return a.time.localeCompare(b.time);
}

/** `2026-06-11` → `WED · JUN 11` (uppercased for the terminal aesthetic). */
function formatDayLabel(isoDate: string): string {
  // Parse as UTC noon to avoid timezone date-shift on the label.
  const d = new Date(`${isoDate}T12:00:00Z`);
  const label = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
  // `Wed, Jun 11` → `WED · JUN 11`
  return label.replace(',', ' ·').toUpperCase();
}

/**
 * Public API. Returns the high-impact USD feed grouped chronologically by date,
 * each group's events sorted by time. Empty array when nothing qualifies.
 */
export function getHighImpactUsdEvents(): EventGroup[] {
  const filtered = RAW_FEED.filter(isTradeable);

  const byDate = new Map<string, EconomicEvent[]>();
  for (const event of filtered) {
    const bucket = byDate.get(event.date);
    if (bucket) bucket.push(event);
    else byDate.set(event.date, [event]);
  }

  return [...byDate.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => ({
      date,
      label: formatDayLabel(date),
      events: byDate.get(date)!.slice().sort(byTime),
    }));
}
