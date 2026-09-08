// User settings — the single doc that backs the /dashboard/settings page.
// Everything Clerk-native (name/email/photo) is read directly from Clerk;
// this shape holds only the app-level preferences the trader chooses.
// Persisted through the generic user_collections KV store as one JSON blob
// (kind: SETTINGS_KIND), the same shape as every other per-user preference
// doc in the app — so it participates in the cross-tab sync + cross-device
// hydration flows without any new plumbing.

import type { InstrumentKey } from '../instruments';
import { resolveZone } from '../time/zone';
import { DEFAULT_SESSIONS, normalizeSessions, type SessionDef } from '../sessions';

export const SETTINGS_KIND = 'user_settings_v1';
export const SETTINGS_KEY  = 'onyx_user_settings_v1';

/** Which trading style the trader identifies with — used by the AI coach
    to phrase advice for a scalper vs a swing trader. */
export type TradingStyle =
  | 'scalper'    // seconds to minutes
  | 'day'        // day trader — closes intraday
  | 'swing'      // days to weeks
  | 'position';  // weeks+

export interface UserSettings {
  /** ── Profile ─────────────────────────────────────────────────────── */
  /** Trader nickname — how the coach addresses them. Falls back to Clerk
      first name when empty. */
  nickname: string;
  /** Free-form short bio (max 240 chars) — surfaced to the AI coach as
      context for phrasing. */
  bio: string;
  /** Trading style category — helps the coach frame advice. */
  tradingStyle: TradingStyle;

  /** ── Trading defaults ────────────────────────────────────────────── */
  /** Instrument the trade form pre-selects on a FIRST trade.
   *
   *  After that the form remembers the last instrument used on this device,
   *  which is the better guess and the behaviour that already shipped. This
   *  seeds it — for a while the setting was read by nothing at all, so the
   *  caption promised a behaviour the form did not have. */
  defaultSymbol: InstrumentKey;
  /** Account starting balance in USD — anchors the equity curve on
      the dashboard when no explicit balance history exists. */
  accountStartUsd: number;
  // `displayUnit` used to live here: a five-way picker on the settings page,
  // captioned "how P&L statistics are shown on the dashboard and on trade
  // cards", read by nothing in the app. A control that changes nothing is
  // worse than a missing one — the trader sets it, sees no change, and starts
  // doubting the settings that DO work. Removed with the picker. An older
  // stored doc may still carry the key; it is simply ignored.
  /** The clock the app runs on, as an IANA identifier.
   *
   *  This is a real setting, not a caption. Session detection and the date a
   *  trade is filed under both resolve through it — see lib/time/zone.ts. It
   *  replaces `timezoneLabel`, which was free text nothing ever read. */
  timezone: string;
  /** @deprecated The old free-text field. Kept so an existing doc can be
   *  migrated on read — never written again. */
  timezoneLabel?: string;
  /** The trader's own session windows.
   *
   *  Read wherever the app asks "which session is this" — see lib/sessions.ts.
   *  A trader who does not trade New York PM switches it off; a trader whose
   *  London starts at 08:00 moves it. Absent on an older doc, which is why
   *  every reader normalizes rather than trusting the shape. */
  sessions: SessionDef[];

  /** When the trader finished (or dismissed) the first-run setup.
   *
   *  Its ABSENCE is what makes the setup appear, so it is written on both
   *  paths — finishing and skipping. A trader who skipped chose the defaults
   *  deliberately; re-asking would be nagging, and re-asking on a device they
   *  signed into later would be worse, since the doc syncs. */
  onboardedAt?: number;

  /** Bookkeeping — used by the sync layer to pick a winner across
      devices (newest updatedAt wins). */
  updatedAt?: number;
}

/** The single source of truth for what a fresh account sees. Every field
    the settings page renders MUST have a default here — otherwise a form
    input would land on `undefined` and React would flip it from
    controlled → uncontrolled mid-render. */
export const DEFAULT_SETTINGS: UserSettings = {
  nickname: '',
  bio: '',
  tradingStyle: 'day',

  defaultSymbol: 'ES',
  accountStartUsd: 25_000,
  timezone: 'Asia/Jerusalem',
  sessions: DEFAULT_SESSIONS,
};

/** Coalesce a partial (possibly cloud-hydrated) settings doc into a full
    UserSettings by filling missing fields from the defaults. Keeps the
    settings page from breaking when the schema grows a new field before
    an old user's cloud doc has been re-saved. */
export function withDefaults(partial: Partial<UserSettings> | null | undefined): UserSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(partial ?? {}) };
  // Migrate the old free-text timezone. A doc written before the picker
  // existed carries something like "Israel (Asia/Jerusalem)" — or whatever was
  // typed into it — and no `timezone` at all. Reading an id out of it is what
  // keeps an existing account from being silently reset to the default.
  if (!partial?.timezone) merged.timezone = resolveZone(partial?.timezoneLabel);
  // Never trust the stored shape: this doc is user-editable, syncs across
  // devices, and predates the sessions field entirely.
  merged.sessions = normalizeSessions(partial?.sessions);
  return merged;
}
