// ─────────────────────────────────────────────────────────────────────────────
// The trader's own confirmation tags — the catalogue, not the trades.
//
// The tags themselves have always been safe: they are written onto every trade
// and travel with it to the cloud, so the analysis of "IFVG 1M vs IFVG 5M" has
// never been at risk. What was device-only was the LIST OF BUTTONS — the
// vocabulary. A trader who invented "IFVG 1M" on their laptop opened the app
// on their phone, did not see the chip, and typed it again.
//
// Retyping is where the real damage was. "IFVG 1m" and "IFVG 1M" are two
// different strings, so they became two different tags, each carrying half the
// history — and a split sample is worse than a missing one, because it looks
// like data. It clears no sample floor, surfaces no pattern, and gives no sign
// that the two halves belong together.
//
// So the catalogue moves to the shared store, per user, over the same
// user_collections sync the rules and day plans already use.
//
// WHY THE TAG IS ITS OWN ID
//
// Sync needs a stable identity per row. Generating one would mean two devices
// that each invented "Silver Bullet" ending up with two rows and a duplicate
// chip. The tag text IS the identity — it is what gets written onto trades and
// what the analytics group by — so using it as the id makes the merge
// idempotent and a tombstone actually remove the right chip.
// ─────────────────────────────────────────────────────────────────────────────

import type { Syncable } from './sync/merge';
import { hydrateList, commitList } from './sync/collections';

/** The tags the app ships with. Kept in the code rather than seeded into every
 *  trader's catalogue: shipping them as rows would make them deletable per
 *  account, and a "default" one account has removed is a support question
 *  nobody wants. */
export const DEFAULT_CONFIRMATIONS = ['SMT', 'IFVG', 'CISD', 'ORDER_BLOCK'] as const;

export const CONFIRMATION_LABELS: Record<string, string> = { ORDER_BLOCK: 'Order Block' };

export const labelForConfirmation = (tag: string) => CONFIRMATION_LABELS[tag] ?? tag;

export const CONFIRMATIONS_KIND = 'confirmations';
export const CONFIRMATIONS_KEY  = 'onyx_confirmations_v2';
/** The device-only list this replaces. Read once, to migrate, never written. */
export const LEGACY_CONFIRMATIONS_KEY = 'onyx_confirmations';

export interface CustomConfirmation extends Syncable {
  /** Same string as `tag`. See the header: identity is the text itself. */
  id: string;
  tag: string;
}

/** Whitespace-collapsed. Not case-folded.
 *
 *  Case is left alone deliberately: a trader who writes "OB" and a trader who
 *  writes "ob" mean the same thing, but so might "Sweep" and "SWEEP" mean two
 *  different things to someone who uses capitals for a stronger version. What
 *  is unambiguously an accident is a stray space or a double space, so that is
 *  all this fixes. Duplicate detection below is case-insensitive, which
 *  prevents the split without overruling the trader's own spelling. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

const isBuiltIn = (tag: string) =>
  DEFAULT_CONFIRMATIONS.some(d => d.toLowerCase() === tag.toLowerCase());

function readLegacy(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_CONFIRMATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string' && s.length > 0)
      : [];
  } catch {
    return [];
  }
}

/** Turn whatever the old key held into rows, dropping built-ins and
 *  case-insensitive duplicates. Pure, so the migration is testable without a
 *  browser. */
export function migrateLegacy(legacy: string[], now = Date.now()): CustomConfirmation[] {
  const out: CustomConfirmation[] = [];
  const seen = new Set<string>();
  for (const raw of legacy) {
    const tag = normalizeTag(raw);
    if (!tag || isBuiltIn(tag)) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: tag, tag, updatedAt: now });
  }
  return out;
}

/** Merge a new tag into a list, or return null when it is already there.
 *
 *  Null rather than a no-op list so the caller can tell "added" from "you
 *  already have this" — the difference between closing the input and telling
 *  the trader why nothing appeared. */
export function addTag(list: CustomConfirmation[], raw: string, now = Date.now()): CustomConfirmation[] | null {
  const tag = normalizeTag(raw);
  if (!tag) return null;
  if (isBuiltIn(tag)) return null;
  if (list.some(c => c.tag.toLowerCase() === tag.toLowerCase())) return null;
  return [...list, { id: tag, tag, updatedAt: now }];
}

export function removeTag(list: CustomConfirmation[], tag: string): CustomConfirmation[] {
  return list.filter(c => c.tag !== tag);
}

/** The chips to render: the built-ins, then the trader's own, deduped against
 *  the built-ins case-insensitively so an old catalogue holding "smt" does not
 *  produce two chips that mean the same thing. */
export function chipList(custom: CustomConfirmation[]): string[] {
  return [
    ...DEFAULT_CONFIRMATIONS,
    ...custom.map(c => c.tag).filter(t => !isBuiltIn(t)),
  ];
}

/** Load the catalogue: cloud merged with local, migrating the device-only list
 *  on first run.
 *
 *  The migration writes into the NEW key before hydrating, never into the old
 *  one. The old key is left untouched on purpose — if this ships broken, a
 *  trader's vocabulary is still sitting where it always was. */
export async function loadConfirmations(): Promise<CustomConfirmation[]> {
  if (typeof window === 'undefined') return [];

  const alreadyMigrated = window.localStorage.getItem(CONFIRMATIONS_KEY) !== null;
  if (!alreadyMigrated) {
    const rows = migrateLegacy(readLegacy());
    try {
      window.localStorage.setItem(CONFIRMATIONS_KEY, JSON.stringify(rows));
    } catch { /* quota — hydrate will still merge from the cloud */ }
  }

  try {
    return await hydrateList<CustomConfirmation>(CONFIRMATIONS_KIND, CONFIRMATIONS_KEY);
  } catch {
    // Offline or the endpoint is down. The chips are a convenience; falling
    // back to whatever is on the device keeps the form usable.
    try {
      const raw = window.localStorage.getItem(CONFIRMATIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as CustomConfirmation[]).filter(c => !c.deleted) : [];
    } catch {
      return [];
    }
  }
}

/** Persist the catalogue. commitList handles the tombstones, so a tag deleted
 *  on one device disappears on the other rather than coming back on the next
 *  merge. */
export async function saveConfirmations(list: CustomConfirmation[]): Promise<void> {
  await commitList<CustomConfirmation>(CONFIRMATIONS_KIND, CONFIRMATIONS_KEY, list);
}
