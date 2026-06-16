// ─────────────────────────────────────────────────────────────────────────────
// Macro Data Engine — economic calendar utility.
// Mirrors the Forex Factory / Investing.com event model. The public API exposes
// ONLY the high-impact USD feed, grouped chronologically, for the macro terminal.
//
// The feed is parameterized by a `DateRange` (see lib/dateUtils). The widget
// passes the live trading week, so the engine is autonomous: no date is ever
// hardcoded at the call site — it is computed from the system clock each render.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import type { DateRange } from './dateUtils';
import { addIsoDays } from './dateUtils';
import { logger } from './logger';

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

// ── External feed: schema + normalization ───────────────────────────────────
// Each Apify dataset item is a keyed object. We validate it at runtime with Zod
// before trusting it, so an upstream schema change surfaces as a logged,
// pinpointed mismatch instead of a silent `undefined` propagating downstream.

const IMPACT_MAP: Record<string, Impact> = { high: 'High', medium: 'Medium', low: 'Low' };
const KNOWN_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY'] as const;

/**
 * Runtime schema for ONE Forex Factory dataset item from the actor.
 *
 * - Core fields (`date`, `currency`, `impact`, `title`) are required — an item
 *   missing any of these is unusable and rejected.
 * - Outcome fields (`actual`/`forecast`/`previous`) are `string | number | null`
 *   and optional; feeds send `""`, `null`, or omit them interchangeably.
 * - `eventId` may be a string or number depending on the actor.
 * - Unknown keys ("…etc.") are stripped by `z.object`, not an error.
 */
const ForexFactoryItemSchema = z.object({
  eventId: z.union([z.string(), z.number()]).optional(),
  url: z.string().optional(),
  date: z.string(),
  time: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  currency: z.string(),
  impact: z.string(),
  title: z.string(),
  actual: z.union([z.string(), z.number()]).nullish(),
  forecast: z.union([z.string(), z.number()]).nullish(),
  previous: z.union([z.string(), z.number()]).nullish(),
});

/** A single validated item (the shape `normalizeEvent` consumes). */
export type ForexFactoryEvent = z.infer<typeof ForexFactoryItemSchema>;

/** The full Apify response: an array of dataset items. */
export type ForexFactoryApiResponse = ForexFactoryEvent[];

/**
 * Validate the unwrapped dataset items against the schema. Validates per-item so
 * one malformed row doesn't discard the whole batch; every rejected row is
 * logged with its array index and the exact Zod issues (path + message).
 */
function validateItems(items: unknown[]): ForexFactoryApiResponse {
  const valid: ForexFactoryApiResponse = [];
  for (let i = 0; i < items.length; i++) {
    const result = ForexFactoryItemSchema.safeParse(items[i]);
    if (result.success) {
      valid.push(result.data);
    } else {
      logger.warn('apify.calendar.item_schema_mismatch', {
        index: i,
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      });
    }
  }
  return valid;
}

/** Trim a string/number outcome value; treat blanks and placeholders as null. */
function cleanMetric(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  // Empty or pure placeholder dashes carry no data.
  if (text === '' || /^[-–—]$/.test(text)) return null;
  return text;
}

/**
 * Map ONE Zod-validated item onto our `EconomicEvent`. The data is already
 * shape-checked, so this is pure field mapping. Returns `null` only for a
 * currency outside our coverage set (the `Currency` union must hold).
 *
 * Outcome values (`actual`/`forecast`/`previous`) are kept as display tokens
 * (`"0.3%"`, `"224K"`, `"<5.50%"`) — see note on numeric handling below.
 */
function normalizeEvent(raw: ForexFactoryEvent, index: number): EconomicEvent | null {
  const currency = raw.currency.trim().toUpperCase();
  if (!(KNOWN_CURRENCIES as readonly string[]).includes(currency)) return null;

  const date = raw.date.slice(0, 10); // tolerate "YYYY-MM-DD" or a full ISO timestamp
  const time = (raw.time ?? '').trim() || 'All Day';

  return {
    id: `ff-${raw.eventId ?? `${date}-${index}`}`,
    date,
    time, // as the actor reports it (FF display zone); no timezone math applied
    currency: currency as Currency,
    impact: IMPACT_MAP[raw.impact.trim().toLowerCase()] ?? 'Low', // unknown → Low (filtered out)
    title: raw.title.trim(),
    forecast: cleanMetric(raw.forecast),
    previous: cleanMetric(raw.previous),
    actual: cleanMetric(raw.actual),
  };
}

// ── Data-fetching layer ──────────────────────────────────────────────────────

/** How many times to re-attempt a failed request before giving up. */
const FETCH_RETRIES = 1;
/** ISR window: re-run the actor at most once an hour (seconds). */
const REVALIDATE_SECONDS = 3600;

/** Error carrying the upstream HTTP status, for structured logging. */
class HttpError extends Error {
  constructor(readonly status: number, readonly statusText: string) {
    super(`Apify run-sync responded ${status} ${statusText}`);
    this.name = 'HttpError';
  }
}

/**
 * GET the URL with hourly ISR caching, retrying once on failure. A retry covers
 * both a thrown network error and a non-2xx response. Throws if every attempt
 * fails, so the caller can fall back to the "unavailable" state.
 */
async function fetchWithRetry(url: URL, retries = FETCH_RETRIES): Promise<Response> {
  // ⚠️ TEMP DEBUG — log the exact URL with the token redacted (never print the
  //    raw token; it can leak into terminal scrollback / log aggregators).
  const safeUrl = new URL(url);
  if (safeUrl.searchParams.has('token')) safeUrl.searchParams.set('token', '***REDACTED***');
  console.log('[DEBUG fetchNews] requesting:', safeUrl.toString());

  try {
    // ⚠️ TEMP DEBUG — `cache: 'no-store'` forces a real network call on every
    //    render. Restore `next: { revalidate: REVALIDATE_SECONDS, tags: [...] }`
    //    when done debugging, or the cache will hide live changes.
    const res = await fetch(url, { cache: 'no-store' });
    // const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS, tags: ['macro-calendar'] } });

    console.log('[DEBUG fetchNews] response status:', res.status, res.statusText); // ⚠️ TEMP DEBUG
    if (!res.ok) throw new HttpError(res.status, res.statusText);
    return res;
  } catch (err) {
    // ⚠️ TEMP DEBUG — full stack so the exact failure is visible in the terminal.
    console.error('[DEBUG fetchNews] fetch failed:', err instanceof Error ? err.stack : err);
    if (retries > 0) {
      logger.warn('apify.calendar.fetch_retry', {
        status: err instanceof HttpError ? err.status : null,
        error: err instanceof Error ? err.message : String(err),
        retriesLeft: retries - 1,
      });
      return fetchWithRetry(url, retries - 1);
    }
    throw err;
  }
}

/** Pull the dataset-item array out of Apify's response, whatever the wrapping. */
function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as { items?: unknown; data?: { items?: unknown } };
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.data?.items)) return obj.data!.items;
  }
  return [];
}

/**
 * The single integration seam. Runs the Apify actor via the GET
 * "Run Actor synchronously and get dataset items" endpoint, validates the
 * response with Zod, then normalizes it to `EconomicEvent[]`. Throws on a failed
 * request so the caller can surface a "Data unavailable" state.
 *
 * Reads its config from server-only env (see .env.example). Never prefix these
 * with NEXT_PUBLIC_ — that would inline the token into the browser bundle. When
 * `FF_CALENDAR_URL` is unset (e.g. local dev before you wire Apify) it falls
 * back to the bundled mock so the dashboard still renders.
 */
export async function fetchNews(range: DateRange): Promise<EconomicEvent[]> {
  const endpoint = process.env.FF_CALENDAR_URL; // Apify run-sync-get-dataset-items URL
  const token = process.env.FF_CALENDAR_KEY; // Apify API token (optional if embedded in URL)

  if (!endpoint) return buildMockFeed(range);

  const url = new URL(endpoint);
  // Apify accepts the token embedded in the URL (?token=…, as copied from the
  // console) or supplied here. Only append it if the URL doesn't already carry one.
  if (token && !url.searchParams.has('token')) url.searchParams.set('token', token);

  const res = await fetchWithRetry(url);

  const payload = (await res.json()) as unknown;
  const items = extractItems(payload);

  if (items.length === 0) return buildMockFeed(range);

  const validated = validateItems(items);
  if (validated.length === 0) return buildMockFeed(range);

  return validated
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
  // ⚠️ TEMP DEBUG — 'Data unavailable' fallback disabled so errors propagate and
  //    stop rendering, surfacing the real failure in the terminal / error overlay.
  //    Restore the try/catch below when done debugging.
  const feed = await fetchNews(range);
  // let feed: EconomicEvent[];
  // try {
  //   feed = await fetchNews(range);
  // } catch (err) {
  //   logger.error('apify.calendar.unavailable', {
  //     status: err instanceof HttpError ? err.status : null,
  //     error: err instanceof Error ? err.message : String(err),
  //     range,
  //   });
  //   return { status: 'unavailable', groups: [] };
  // }

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
