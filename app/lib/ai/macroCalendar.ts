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
const TZ = 'Asia/Jerusalem';

export type Impact = 'High' | 'Medium' | 'Low' | 'Holiday';

export interface MacroEvent {
  title: string;
  currency: string;      // feed's "country" is really a currency code, e.g. "USD"
  impact: Impact;
  dateIsrael: string;    // 'YYYY-MM-DD' in Israel time
  timeIsrael: string;    // 'HH:mm' in Israel time ('' when the feed gives no clock time)
}

interface RawEvent { title?: unknown; country?: unknown; date?: unknown; impact?: unknown; }

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

const IMPACT_ORDER: Record<Impact, number> = { High: 0, Medium: 1, Low: 2, Holiday: 3 };

function line(e: MacroEvent): string {
  const sess = sessionKeyForTime(e.timeIsrael);
  const sessTag = sess ? ` (${SESS.find(s => s.key === sess)!.en} session)` : '';
  const time = e.timeIsrael || 'all-day';
  return `${time}${sessTag} — ${e.impact.toUpperCase()} · ${e.currency} · ${e.title}`;
}

/** Builds the real-macro-events block the model is allowed to cite for
    "what's today / this week" questions. Empty string when there's nothing. */
export function buildMacroBlock(events: MacroEvent[], today: string): string {
  if (!events.length) return '';
  const todays = events
    .filter(e => e.dateIsrael === today)
    .sort((a, b) => a.timeIsrael.localeCompare(b.timeIsrael));

  const weekAhead = events
    .filter(e => e.dateIsrael > today && (e.impact === 'High' || e.impact === 'Medium'))
    .sort((a, b) => (a.dateIsrael + a.timeIsrael).localeCompare(b.dateIsrael + b.timeIsrael))
    .slice(0, 12);

  const parts: string[] = [];
  parts.push(todays.length
    ? `TODAY (${today}, Israel time):\n${todays.map(e => `• ${line(e)}`).join('\n')}`
    : `TODAY (${today}, Israel time): no scheduled macro events.`);
  if (weekAhead.length) {
    parts.push(`LATER THIS WEEK (higher-impact, Israel time):\n${weekAhead
      .map(e => `• ${e.dateIsrael} ${line(e)}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** If today's high-impact events land in the trader's historically weakest
    session, returns a natural-language hint for the model to weave in once.
    Returns '' when there's no meaningful overlap. Pure. */
export function computeMacroOverlap(events: MacroEvent[], analysis: FullAnalysis, today: string): string {
  const todaysHigh = events.filter(e => e.dateIsrael === today && e.impact === 'High' && sessionKeyForTime(e.timeIsrael));
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

/** Returns this week's normalized macro events (Israel time), fetching the feed
    at most once per Israel day. Never throws — returns [] on any failure, so the
    coach cleanly falls back to teaching the recurring reports. */
export async function getMacroEvents(supabase: SupabaseClient | null): Promise<MacroEvent[]> {
  const today = israelToday();
  if (memCache && memCache.day === today) return memCache.events;

  if (supabase) {
    try {
      const { data } = await supabase.from('macro_calendar_cache').select('payload').eq('day', today).maybeSingle();
      if (data?.payload && Array.isArray(data.payload)) {
        memCache = { day: today, events: data.payload as MacroEvent[] };
        return memCache.events;
      }
    } catch { /* fall through to a fresh fetch */ }
  }

  let events: MacroEvent[] = [];
  try {
    const res = await fetch(FEED_URL, { headers: { 'User-Agent': 'OnyxTrainer/1.0 (+trading journal)' } });
    if (res.ok) events = normalizeEvents(await res.json());
    else logger.warn('macro feed non-ok', { status: res.status });
  } catch (err) {
    logger.warn('macro feed fetch failed', { error: err instanceof Error ? err.message : String(err) });
  }

  memCache = { day: today, events };
  if (supabase && events.length) {
    try {
      await supabase.from('macro_calendar_cache').upsert(
        { day: today, payload: events, fetched_at: new Date().toISOString() },
        { onConflict: 'day' },
      );
    } catch { /* cache write is best-effort */ }
  }
  return events;
}
