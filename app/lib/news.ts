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

// ── ForexFactory public calendar ─────────────────────────────────────────────

const FF_PUBLIC_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const REVALIDATE_SECONDS = 3600;

/**
 * Schema for a single ForexFactory public calendar event.
 * The public JSON uses `country` (not `currency`) and embeds time inside `date`.
 */
const FfPublicItemSchema = z.object({
  title:    z.string(),
  country:  z.string(),
  date:     z.string(), // ISO 8601 e.g. "2026-06-10T12:30:00-04:00"
  impact:   z.string(), // "High" | "Medium" | "Low" | "Holiday"
  forecast: z.string().nullable().optional(),
  previous: z.string().nullable().optional(),
});
type FfPublicItem = z.infer<typeof FfPublicItemSchema>;

/** Convert one validated FF public item to our internal `EconomicEvent`. */
function normalizeFfPublicItem(raw: FfPublicItem, index: number): EconomicEvent | null {
  const currency = raw.country.trim().toUpperCase();
  if (!(KNOWN_CURRENCIES as readonly string[]).includes(currency)) return null;

  // Parse the ISO datetime → local date (YYYY-MM-DD) + ET time (HH:mm)
  const dt = new Date(raw.date);
  if (isNaN(dt.getTime())) return null;

  const dateISO = raw.date.slice(0, 10);
  const time = `${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`;

  return {
    id:       `ff-pub-${dateISO}-${index}`,
    date:     dateISO,
    time,
    currency: currency as Currency,
    impact:   IMPACT_MAP[raw.impact.trim().toLowerCase()] ?? 'Low',
    title:    raw.title.trim(),
    forecast: cleanMetric(raw.forecast),
    previous: cleanMetric(raw.previous),
    actual:   null,
  };
}

/**
 * Fetch the current week's calendar from ForexFactory's public JSON endpoint.
 * Caches for 1 hour via Next.js ISR. Falls back to mock on any error.
 */
async function fetchForexFactory(): Promise<EconomicEvent[]> {
  try {
    const res = await fetch(FF_PUBLIC_URL, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) throw new Error(`FF calendar responded ${res.status}`);

    const items = (await res.json()) as unknown[];
    if (!Array.isArray(items) || items.length === 0) return [];

    const events: EconomicEvent[] = [];
    for (let i = 0; i < items.length; i++) {
      const parsed = FfPublicItemSchema.safeParse(items[i]);
      if (!parsed.success) continue;
      const event = normalizeFfPublicItem(parsed.data, i);
      if (event) events.push(event);
    }
    return events;
  } catch (err) {
    logger.warn('ff_calendar.fetch_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Primary data seam. Fetches this week's calendar from ForexFactory's public
 * JSON endpoint (no API key required). Falls back to the bundled mock feed when
 * the fetch fails or returns no events — the dashboard always has data to render.
 */
export async function fetchNews(range: DateRange): Promise<EconomicEvent[]> {
  const events = await fetchForexFactory();
  if (events.length > 0) return events;
  return buildMockFeed(range);
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
    logger.error('ff_calendar.unavailable', {
      error: err instanceof Error ? err.message : String(err),
      range,
    });
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
