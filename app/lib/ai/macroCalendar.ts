// ─────────────────────────────────────────────────────────────────────────────
// Macro economic calendar for the coach. Source is the public, ForexFactory-
// sourced weekly JSON feed published by FairEconomy (nfs.faireconomy.media) —
// a sanctioned public feed, NOT scraping the ForexFactory site. All event times
// are absolute (ISO with offset), so we convert every one to Israel time here.
//
// The feed is fetched at most once per Israel calendar day and cached both in
// memory (per warm server instance) and, when Supabase is configured, in the
// macro_calendar_cache table (global once-per-day, so serverless cold starts
// don't each re-hit the feed). Everything below the fetch is pure and testable.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FullAnalysis } from '../analytics';
import { SESS, sessionForHour, type SessionKey } from '../sessions';
import { logger } from '../logger';

const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const FEED_URL_LAST = 'https://nfs.faireconomy.media/ff_calendar_lastweek.json';
const FEED_URL_NEXT = 'https://nfs.faireconomy.media/ff_calendar_nextweek.json';
const TZ = 'Asia/Jerusalem';

export type Impact = 'High' | 'Medium' | 'Low' | 'Holiday';

export interface MacroEvent {
  title: string;
  currency: string;      // feed's "country" is really a currency code, e.g. "USD"
  impact: Impact;
  dateIsrael: string;    // 'YYYY-MM-DD' in Israel time
  timeIsrael: string;    // 'HH:mm' in Israel time ('' when the feed gives no clock time)
  forecast?: string;     // consensus estimate ('' when the feed omits it)
  previous?: string;     // last release
  actual?: string;       // released value ('' until publication time)
}

interface RawEvent {
  title?: unknown; country?: unknown; date?: unknown; impact?: unknown;
  forecast?: unknown; previous?: unknown; actual?: unknown;
}

// ── Time helpers (pure) ──────────────────────────────────────────────────────

function partsInTz(d: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** Today's date in Israel as 'YYYY-MM-DD'. */
export function israelToday(now: Date = new Date()): string {
  const p = partsInTz(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Splits an absolute ISO timestamp into its Israel-time date and clock time. */
export function toIsraelParts(iso: string): { dateIsrael: string; timeIsrael: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = partsInTz(d);
  const hour = p.hour === '24' ? '00' : p.hour; // some engines emit '24' at midnight
  return { dateIsrael: `${p.year}-${p.month}-${p.day}`, timeIsrael: `${hour}:${p.minute}` };
}

function normImpact(v: unknown): Impact {
  const s = String(v ?? '').toLowerCase();
  if (s === 'high') return 'High';
  if (s === 'medium') return 'Medium';
  if (s === 'holiday') return 'Holiday';
  return 'Low';
}

function normStr(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

/** Feed rows → normalized events (Israel time). Invalid rows are dropped. */
export function normalizeEvents(raw: unknown): MacroEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: MacroEvent[] = [];
  for (const r of raw as RawEvent[]) {
    const title = typeof r?.title === 'string' ? r.title : '';
    const iso = typeof r?.date === 'string' ? r.date : '';
    if (!title || !iso) continue;
    const parts = toIsraelParts(iso);
    if (!parts) continue;
    out.push({
      title,
      currency: typeof r?.country === 'string' ? r.country : '',
      impact: normImpact(r?.impact),
      dateIsrael: parts.dateIsrael,
      timeIsrael: parts.timeIsrael,
      forecast: normStr(r?.forecast),
      previous: normStr(r?.previous),
      actual: normStr(r?.actual),
    });
  }
  return out;
}

/** The session (Israel-time window) a 'HH:mm' clock time falls in, or null. */
export function sessionKeyForTime(hhmm: string): SessionKey | null {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return sessionForHour(h + (m || 0) / 60);
}

// ── Prompt block (pure) ──────────────────────────────────────────────────────

function line(e: MacroEvent): string {
  const sess = sessionKeyForTime(e.timeIsrael);
  const sessTag = sess ? ` (${SESS.find(s => s.key === sess)!.en} session)` : '';
  const time = e.timeIsrael || 'all-day';
  return `${time}${sessTag} — ${e.impact.toUpperCase()} · ${e.currency} · ${e.title}`;
}

/** What the coach leads with by default: high-impact US-dollar releases and
    bank holidays. Everything else (other currencies, low/medium impact) is
    kept only as optional context the coach mentions only if asked. */
export function isPrimaryEvent(e: MacroEvent): boolean {
  return (e.impact === 'High' && e.currency === 'USD') || e.impact === 'Holiday';
}

/** Builds the real-macro-events block the model is allowed to cite for
    "what's today / this week" questions. High-impact USD events and bank
    holidays are the headline; other events are listed separately as optional.
    Empty string when there's nothing at all. */
export function buildMacroBlock(events: MacroEvent[], today: string): string {
  if (!events.length) return '';
  const todays = events
    .filter(e => e.dateIsrael === today)
    .sort((a, b) => a.timeIsrael.localeCompare(b.timeIsrael));
  const todayPrimary = todays.filter(isPrimaryEvent);
  const todayOther = todays.filter(e => !isPrimaryEvent(e));

  const weekPrimary = events
    .filter(e => e.dateIsrael > today && isPrimaryEvent(e))
    .sort((a, b) => (a.dateIsrael + a.timeIsrael).localeCompare(b.dateIsrael + b.timeIsrael))
    .slice(0, 12);

  const parts: string[] = [];
  parts.push(todayPrimary.length
    ? `TODAY (${today}, Israel time) — HIGH-IMPACT USD EVENTS & BANK HOLIDAYS (this is what matters, lead with these):\n${todayPrimary.map(e => `• ${line(e)}`).join('\n')}`
    : `TODAY (${today}, Israel time): no high-impact USD events or bank holidays scheduled.`);

  if (weekPrimary.length) {
    parts.push(`LATER THIS WEEK — high-impact USD events & bank holidays (Israel time):\n${weekPrimary
      .map(e => `• ${e.dateIsrael} ${line(e)}`).join('\n')}`);
  }

  if (todayOther.length) {
    parts.push(`OTHER EVENTS TODAY — lower priority (other currencies or lower impact). Do NOT bring these up unless the trader explicitly asks about them:\n${todayOther.map(e => `• ${line(e)}`).join('\n')}`);
  }

  return parts.join('\n\n');
}

/** If today's high-impact events land in the trader's historically weakest
    session, returns a natural-language hint for the model to weave in once.
    Returns '' when there's no meaningful overlap. Pure. */
export function computeMacroOverlap(events: MacroEvent[], analysis: FullAnalysis, today: string): string {
  const todaysHigh = events.filter(e => e.dateIsrael === today && e.impact === 'High' && e.currency === 'USD' && sessionKeyForTime(e.timeIsrael));
  if (!todaysHigh.length) return '';

  const sessions = analysis.sessions.filter(g => g.confidence.sampleSize >= 6);
  if (!sessions.length) return '';
  const weakest = [...sessions].sort((a, b) => a.winRate - b.winRate)[0];
  const weakKey = sessionKeyForLabel(weakest.label);
  if (!weakKey) return '';

  const hits = todaysHigh.filter(e => sessionKeyForTime(e.timeIsrael) === weakKey);
  if (!hits.length) return '';

  const sessLabel = SESS.find(s => s.key === weakKey)!.en;
  const list = hits.map(e => `${e.timeIsrael} ${e.currency} ${e.title}`).join('; ');
  return `Today's high-impact event(s) — ${list} — fall during the ${sessLabel} session, which is historically this trader's weakest (${weakest.winRate.toFixed(0)}% win rate over ${weakest.confidence.sampleSize} trades). Mention this once, naturally, as a heads-up to be extra careful with execution around that time — never as a market prediction and never as a "don't trade" instruction.`;
}

function sessionKeyForLabel(label: string): SessionKey | null {
  const l = label.trim().toLowerCase();
  const hit = SESS.find(s => s.key === l || s.en.toLowerCase() === l || s.he === label.trim());
  return hit ? hit.key : null;
}

// ── Fetch + cache (IO) ───────────────────────────────────────────────────────

let memCache: { day: string; events: MacroEvent[] } | null = null;
let memCacheJournal: { day: string; events: MacroEvent[] } | null = null;

/** De-dup identical rows (same title + date + time + currency) that appear in
    both `thisweek.json` and `nextweek.json` at the week boundary. Later entries
    win — that's the one more likely to already carry an `actual` value. */
function mergeDedupe(...groups: MacroEvent[][]): MacroEvent[] {
  const map = new Map<string, MacroEvent>();
  for (const g of groups) {
    for (const e of g) {
      const key = `${e.dateIsrael}|${e.timeIsrael}|${e.currency}|${e.title}`;
      map.set(key, e);
    }
  }
  return [...map.values()].sort((a, b) => (a.dateIsrael + a.timeIsrael).localeCompare(b.dateIsrael + b.timeIsrael));
}

async function fetchFeed(url: string): Promise<MacroEvent[]> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'OnyxTrainer/1.0 (+trading journal)' } });
    if (!res.ok) { logger.warn('macro feed non-ok', { url, status: res.status }); return []; }
    return normalizeEvents(await res.json());
  } catch (err) {
    logger.warn('macro feed fetch failed', { url, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

async function loadCached(supabase: SupabaseClient, table: string, day: string): Promise<MacroEvent[] | null> {
  try {
    const { data } = await supabase.from(table).select('payload').eq('day', day).maybeSingle();
    if (data?.payload && Array.isArray(data.payload)) return data.payload as MacroEvent[];
  } catch { /* fall through */ }
  return null;
}

async function writeCache(supabase: SupabaseClient, table: string, day: string, events: MacroEvent[]): Promise<void> {
  if (!events.length) return;
  try {
    await supabase.from(table).upsert(
      { day, payload: events, fetched_at: new Date().toISOString() },
      { onConflict: 'day' },
    );
  } catch { /* best-effort */ }
}

/** Returns this week's normalized macro events (Israel time), fetching the feed
    at most once per Israel day. Never throws — returns [] on any failure, so the
    coach cleanly falls back to teaching the recurring reports. */
export async function getMacroEvents(supabase: SupabaseClient | null): Promise<MacroEvent[]> {
  const today = israelToday();
  if (memCache && memCache.day === today) return memCache.events;

  if (supabase) {
    const cached = await loadCached(supabase, 'macro_calendar_cache', today);
    if (cached) { memCache = { day: today, events: cached }; return cached; }
  }

  const events = await fetchFeed(FEED_URL);
  memCache = { day: today, events };
  if (supabase) await writeCache(supabase, 'macro_calendar_cache', today, events);
  return events;
}

/** Returns a 3-week window (last + this + next) for the macro journal page.
    Uses its own cache table so it never fights the coach's this-week cache.
    Falls back to fetching just this-week when the wider fetch fails. */
export async function getMacroJournalEvents(supabase: SupabaseClient | null): Promise<MacroEvent[]> {
  const today = israelToday();
  if (memCacheJournal && memCacheJournal.day === today) return memCacheJournal.events;

  if (supabase) {
    const cached = await loadCached(supabase, 'macro_calendar_journal_cache', today);
    if (cached) { memCacheJournal = { day: today, events: cached }; return cached; }
  }

  const [last, thisW, next] = await Promise.all([
    fetchFeed(FEED_URL_LAST),
    fetchFeed(FEED_URL),
    fetchFeed(FEED_URL_NEXT),
  ]);
  const events = mergeDedupe(last, thisW, next);

  memCacheJournal = { day: today, events };
  if (supabase) await writeCache(supabase, 'macro_calendar_journal_cache', today, events);
  return events;
}
