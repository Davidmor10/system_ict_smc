// ─────────────────────────────────────────────────────────────────────────────
// Cache keys for AI text that DESCRIBES trades.
//
// The panels cache their generated text so a page visit does not re-fire the
// model, and the keys used to carry only a date ("today's insights"). That is
// wrong in one specific, very visible way: delete or edit a trade and the text
// keeps describing the journal as it was this morning — "you have 19 trades,
// 82% win rate" over a journal holding three. The text is stale the moment the
// data behind it changes, not at midnight.
//
// So the cache is keyed by the data as well as the day. Any change to the set
// of trades the text was written about — one added, one deleted, one edited —
// produces a different fingerprint, misses the cache, and re-generates.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry } from '../journal';

/** FNV-1a, 32-bit, hex. Small, dependency-free, and stable across reloads —
 *  all this has to do is change when the input changes. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Identifies the set of trades a piece of generated text was written about.
 *
 *  Sorted by id, so re-ordering the array alone is not a change. Carries the
 *  fields the insights actually talk about — outcome, R, money, session, model
 *  — so an edit that moves any number the text quotes invalidates it, while
 *  editing a screenshot or a note does not burn a model call. OPEN trades are
 *  included by id only: their result is not final and the insights do not
 *  quote them, but they must not vanish from the fingerprint or deleting one
 *  would go unnoticed. */
export function tradesFingerprint(trades: TradeEntry[]): string {
  const parts = trades
    .slice()
    .sort((a, b) => a.id - b.id)
    .map(t => t.result === 'OPEN'
      ? `${t.id}:OPEN`
      : [t.id, t.result, t.tradeR ?? '', t.pnlUsd ?? '', t.session, t.model, t.dateISO].join(':'));
  return `${trades.length}-${hash(parts.join('|'))}`;
}

interface Envelope<T> { fingerprint: string; value: T; updatedAt: string }

/** Reads a cache entry, and treats one written about different trades as a
 *  miss rather than as content. Returns null on anything unexpected — a
 *  corrupt entry must re-generate, never crash a render. */
export function readInsightCache<T>(key: string, fingerprint: string): Envelope<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.fingerprint !== fingerprint) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Writes the entry and drops the same panel's entries from other days, which
 *  otherwise accumulate one dead key per day for as long as the browser lives. */
export function writeInsightCache<T>(key: string, prefix: string, fingerprint: string, value: T, updatedAt: string): void {
  if (typeof window === 'undefined') return;
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const existing = window.localStorage.key(i);
      if (existing && existing !== key && existing.startsWith(prefix)) window.localStorage.removeItem(existing);
    }
    window.localStorage.setItem(key, JSON.stringify({ fingerprint, value, updatedAt } satisfies Envelope<T>));
  } catch { /* storage unavailable or full — the panel just re-generates next time */ }
}
