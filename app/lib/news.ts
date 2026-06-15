// ─────────────────────────────────────────────────────────────────────────────
// Macro Data Engine — economic calendar utility.
// Mirrors the Forex Factory / Investing.com event model. The public API exposes
// ONLY the high-impact USD feed, grouped chronologically, for the macro terminal.
//
// The feed is parameterized by a `DateRange` (see lib/dateUtils). The widget
// passes the live trading week, so the engine is autonomous: no date is ever
// hardcoded at the call site — it is computed from the system clock each render.
// ─────────────────────────────────────────────────────────────────────────────

import type { DateRange } from './dateUtils';
import { addIsoDays } from './dateUtils';

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

/**
 * Result of a feed query. `status: 'unavailable'` means the upstream call failed
 * — the UI should show a "Data unavailable" state rather than an empty calendar
 * (which legitimately means "no high-impact USD events this week").
 */
export interface MacroFeed {
  status: 'ok' | 'unavailable';
  groups: EventGroup[];
}

// ── Mock data ────────────────────────────────────────────────────────────────
// NOTE: demonstration data, not a live calendar. Titles/values repeat week to
// week by design; the dates are what update automatically. Anchored to the
// *requested* week so the terminal always has events to render — it stays
// "Ready" on any date, including the Monday after a weekend roll-over.

/** A weekly event template, positioned by weekday rather than a fixed date. */
interface FeedTemplate {
  /** 0 = Monday … 4 = Friday. */
  dayOffset: number;
  time: string;
  currency: Currency;
  impact: Impact;
  title: string;
  forecast: string | null;
  previous: string | null;
}

// Mixes currencies and impact levels on purpose, so the strict filter below has
// something real to strip out. Mirrors a typical FOMC week.
const WEEK_TEMPLATE: FeedTemplate[] = [
  { dayOffset: 2, time: '08:30',   currency: 'USD', impact: 'High',   title: 'Core CPI m/m',                  forecast: '0.3%',   previous: '0.2%'  },
  { dayOffset: 2, time: '08:30',   currency: 'USD', impact: 'High',   title: 'CPI y/y',                       forecast: '3.1%',   previous: '3.4%'  },
  { dayOffset: 2, time: '10:30',   currency: 'USD', impact: 'Medium', title: 'Crude Oil Inventories',         forecast: '-1.2M',  previous: '0.6M'  },
  { dayOffset: 2, time: '07:00',   currency: 'GBP', impact: 'High',   title: 'BOE Gov Bailey Speaks',         forecast: null,     previous: null    },
  { dayOffset: 3, time: '14:00',   currency: 'USD', impact: 'High',   title: 'FOMC Statement',                forecast: null,     previous: null    },
  { dayOffset: 3, time: '14:00',   currency: 'USD', impact: 'High',   title: 'Federal Funds Rate',            forecast: '<5.50%', previous: '5.50%' },
  { dayOffset: 3, time: '14:30',   currency: 'USD', impact: 'High',   title: 'FOMC Press Conference',         forecast: null,     previous: null    },
  { dayOffset: 3, time: '08:30',   currency: 'USD', impact: 'Medium', title: 'PPI m/m',                       forecast: '0.1%',   previous: '0.5%'  },
  { dayOffset: 3, time: 'All Day', currency: 'EUR', impact: 'Low',    title: 'German Bank Holiday',           forecast: null,     previous: null    },
  { dayOffset: 4, time: '08:30',   currency: 'USD', impact: 'High',   title: 'Unemployment Claims',           forecast: '224K',   previous: '215K'  },
  { dayOffset: 4, time: '08:30',   currency: 'USD', impact: 'Medium', title: 'Retail Sales m/m',              forecast: '0.3%',   previous: '0.1%'  },
  { dayOffset: 4, time: '02:00',   currency: 'JPY', impact: 'High',   title: 'BOJ Policy Rate',               forecast: '0.50%',  previous: '0.50%' },
  { dayOffset: 4, time: '10:00',   currency: 'USD', impact: 'High',   title: 'Prelim UoM Consumer Sentiment', forecast: '73.1',   previous: '74.0'  },
  { dayOffset: 4, time: '08:30',   currency: 'CAD', impact: 'Medium', title: 'Manufacturing Sales m/m',       forecast: '0.4%',   previous: '-0.3%' },
];

/** Materialize the mock template against the Monday of `range`. */
function buildMockFeed(range: DateRange): EconomicEvent[] {
  return WEEK_TEMPLATE.map((t, i) => ({
    id: `evt-${range.startISO}-${i}`,
    date: addIsoDays(range.startISO, t.dayOffset),
    time: t.time,
    currency: t.currency,
    impact: t.impact,
    title: t.title,
    forecast: t.forecast,
    previous: t.previous,
    actual: null,
  }));
}

// ── External feed: shape + normalization ─────────────────────────────────────
// Forex Factory has no public API, so this targets an intermediary that mirrors
// the well-known weekly JSON (faireconomy / "FFCal"-style). Field names below
// match that schema; if your provider differs, this is the ONE place to adjust.

/** Raw row as the intermediary delivers it. Everything optional — feeds vary. */
interface ForexFactoryEvent {
  title?: string;
  /** FF puts the currency code here, e.g. `"USD"`. */
  country?: string;
  /** ISO 8601 with a US-Eastern offset, e.g. `"2026-06-17T08:30:00-04:00"`. */
  date?: string;
  /** `"High" | "Medium" | "Low" | "Holiday"` (casing varies by provider). */
  impact?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

const IMPACT_MAP: Record<string, Impact> = { high: 'High', medium: 'Medium', low: 'Low' };
const KNOWN_CURRENCIES = new Set<string>(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY']);

function emptyToNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/** Split an Eastern-offset timestamp into `YYYY-MM-DD` + `HH:mm`, both in ET. */
function splitEastern(d: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour'); // some runtimes emit "24"
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
}

/**
 * Map one external row onto our `EconomicEvent`. Returns `null` for rows we
 * can't trust (missing fields, bad date, currency outside our coverage) so a
 * single malformed entry never poisons the feed.
 */
function normalizeEvent(raw: ForexFactoryEvent, index: number): EconomicEvent | null {
  if (!raw.title || !raw.date || !raw.country) return null;

  const parsed = new Date(raw.date);
  if (Number.isNaN(parsed.getTime())) return null;

  const currency = raw.country.trim().toUpperCase();
  if (!KNOWN_CURRENCIES.has(currency)) return null;

  const { date, time } = splitEastern(parsed);

  return {
    id: `ff-${date}-${index}`,
    date,
    time,
    currency: currency as Currency,
    impact: IMPACT_MAP[(raw.impact ?? '').toLowerCase()] ?? 'Low', // unknown → Low (filtered out)
    title: raw.title.trim(),
    forecast: emptyToNull(raw.forecast),
    previous: emptyToNull(raw.previous),
    actual: emptyToNull(raw.actual),
  };
}

// ── Data-fetching layer ──────────────────────────────────────────────────────

/**
 * The single integration seam. Fetches the raw calendar for `range` from the
 * intermediary and normalizes it to `EconomicEvent[]`. Throws on a failed
 * request so the caller can surface a "Data unavailable" state.
 *
 * Reads its config from server-only env (see .env.example). Never prefix these
 * with NEXT_PUBLIC_ — that would inline the key into the browser bundle. When
 * `FF_CALENDAR_URL` is unset (e.g. local dev before you wire the provider) it
 * falls back to the bundled mock so the dashboard still renders.
 */
export async function fetchNews(range: DateRange): Promise<EconomicEvent[]> {
  const calendarUrl = process.env.FF_CALENDAR_URL;
  const calendarKey = process.env.FF_CALENDAR_KEY;
  if (!calendarUrl) return buildMockFeed(range);

  const url = new URL(calendarUrl);
  url.searchParams.set('from', range.startISO);
  url.searchParams.set('to', range.endISO);

  const res = await fetch(url, {
    headers: calendarKey ? { 'X-API-Key': calendarKey } : undefined,
    // Calendars change slowly; revalidate hourly to stay fresh without hammering
    // the upstream. Valid in this project's caching model (no `cacheComponents`).
    next: { revalidate: 3600, tags: ['macro-calendar'] },
  });
  if (!res.ok) throw new Error(`Calendar upstream responded ${res.status} ${res.statusText}`);

  const raw = (await res.json()) as ForexFactoryEvent[];
  return raw
    .map(normalizeEvent)
    .filter((event): event is EconomicEvent => event !== null);
}

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
 * Public API. Fetches the calendar for `range`, keeps only high-impact USD
 * events that fall inside the range, and returns them grouped chronologically by
 * date with each group's events sorted by time. `range` is the live trading week
 * supplied by the caller — there are no hardcoded dates here.
 *
 * If the upstream fetch fails, returns `{ status: 'unavailable' }` so the
 * dashboard degrades gracefully instead of crashing.
 */
export async function getHighImpactUsdEvents(range: DateRange): Promise<MacroFeed> {
  let feed: EconomicEvent[];
  try {
    feed = await fetchNews(range);
  } catch (err) {
    console.error('[news] calendar fetch failed — rendering "Data unavailable":', err);
    return { status: 'unavailable', groups: [] };
  }

  const filtered = feed
    .filter(isTradeable)
    // Defensive range-clip: a real API may return padding days either side.
    .filter((event) => event.date >= range.startISO && event.date <= range.endISO);

  const byDate = new Map<string, EconomicEvent[]>();
  for (const event of filtered) {
    const bucket = byDate.get(event.date);
    if (bucket) bucket.push(event);
    else byDate.set(event.date, [event]);
  }

  const groups = [...byDate.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => ({
      date,
      label: formatDayLabel(date),
      events: byDate.get(date)!.slice().sort(byTime),
    }));

  return { status: 'ok', groups };
}
