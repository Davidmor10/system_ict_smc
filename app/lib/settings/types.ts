// User settings — the single doc that backs the /dashboard/settings page.
// Everything Clerk-native (name/email/photo) is read directly from Clerk;
// this shape holds only the app-level preferences the trader chooses.
// Persisted through the generic user_collections KV store as one JSON blob
// (kind: SETTINGS_KIND), the same shape as every other per-user preference
// doc in the app — so it participates in the cross-tab sync + cross-device
// hydration flows without any new plumbing.

import type { InstrumentKey } from '../instruments';
import { resolveZone } from '../time/zone';

export const SETTINGS_KIND = 'user_settings_v1';
export const SETTINGS_KEY  = 'onyx_user_settings_v1';

/** Density affects paddings/gaps across the app. Compact = pack more info,
    spacious = breathe more. Comfortable is the default. */
export type Density = 'compact' | 'comfortable' | 'spacious';

/** Number formatting locale — traders working from Israel default to US
    formatting for prices but many expect thousands separators the EU way. */
export type NumberFormat = 'us' | 'eu';

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
  /** Instrument the trade form pre-selects. */
  defaultSymbol: InstrumentKey;
  /** Account starting balance in USD — anchors the equity curve on
      the dashboard when no explicit balance history exists. */
  accountStartUsd: number;
  /** Preferred display unit for stats — dollar, R, points, ticks, percent. */
  displayUnit: 'dollar' | 'percent' | 'r' | 'ticks' | 'points';
  /** The clock the app runs on, as an IANA identifier.
   *
   *  This is a real setting, not a caption. Session detection and the date a
   *  trade is filed under both resolve through it — see lib/time/zone.ts. It
   *  replaces `timezoneLabel`, which was free text nothing ever read. */
  timezone: string;
  /** @deprecated The old free-text field. Kept so an existing doc can be
   *  migrated on read — never written again. */
  timezoneLabel?: string;

  /** ── Appearance ─────────────────────────────────────────────────── */
  density: Density;
  numberFormat: NumberFormat;
  /** When true, the dashboard's aurora background animation is disabled
      (also honored automatically for `prefers-reduced-motion`). */
  reduceMotion: boolean;

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
  displayUnit: 'dollar',
  timezone: 'Asia/Jerusalem',

  density: 'comfortable',
  numberFormat: 'us',
  reduceMotion: false,
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
  return merged;
}
