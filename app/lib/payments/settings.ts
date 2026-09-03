// ─────────────────────────────────────────────────────────────────────────────
// Where customers send the money.
//
// This lived in environment variables, so changing it needed the Vercel
// dashboard and a redeploy — and until it was set the payment page rendered a
// dash where the number should be. The product was live and uncollectable.
//
// It is a setting, not configuration. The owner types it into their own admin
// screen and the checkout reads it on the next request.
//
// THE ENVIRONMENT STILL WINS WHEN IT IS SET. A deployment that already
// configured these keeps working exactly as before, and nothing has to be
// migrated by hand; the stored value is the fallback, not the override. That
// ordering also means an env var can be used to force a value if the table is
// ever wrong.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerSupabaseClient, isSupabaseConfigured } from '../supabase/server';
import { logger } from '../logger';
import { PLAN_KEYS, type PlanKey } from './plans';

const KEY = 'bit_payment';

export type QrByPlan = Record<PlanKey, string | null>;

export interface BitSettings {
  /** The phone number a transfer is sent to. OPTIONAL, and deliberately so:
   *  it is the owner's personal number and every customer would see it. A QR
   *  encodes the same transfer without publishing it. */
  number: string | null;
  /** Who the customer should see as the recipient. Null when unset. */
  payee: string | null;
  /** One Bit QR per plan, as a data URI, because the amount differs per plan.
   *  Stored rather than committed to /public for the same reason the number is
   *  stored: an owner should not need a deploy to change where money goes. */
  qr: QrByPlan;
}

export const EMPTY_QR: QrByPlan = { starter: null, pro: null, deluxe: null };
export const EMPTY_BIT: BitSettings = { number: null, payee: null, qr: { ...EMPTY_QR } };

/** What a stored QR may be.
 *
 *  Narrow on purpose. This string is rendered into an <img src> on a public
 *  page, so anything that is not a raster image data URI has no business
 *  being there — an svg+xml data URI can carry script, and a remote URL would
 *  let whoever wrote this row make the checkout fetch from anywhere. */
const QR_PREFIX = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** Roughly 90KB decoded. A QR needs a fraction of that; a photo of a screen
 *  does not, and three of those would be a megabyte in the page. */
export const MAX_QR_CHARS = 120_000;

export function isValidQr(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_QR_CHARS && QR_PREFIX.test(v);
}

function normalizeQr(raw: unknown): QrByPlan {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = { ...EMPTY_QR };
  for (const k of PLAN_KEYS) if (isValidQr(src[k])) out[k] = src[k] as string;
  return out;
}

/** Trim, and treat blank as absent.
 *
 *  A settings form submits "" for a cleared field, and an empty string that
 *  reaches the checkout renders as a present-but-blank recipient — the same
 *  silent-misconfiguration shape the dash had. */
export function normalizeBit(input: { number?: unknown; payee?: unknown; qr?: unknown }): BitSettings {
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { number: clean(input.number), payee: clean(input.payee), qr: normalizeQr(input.qr) };
}

/** True when a customer on THIS plan has somewhere to send money.
 *
 *  Per plan, because the QR encodes the amount — a code for PRO does not let
 *  a DELUXE customer pay. Either route is enough on its own: a scannable code,
 *  or a number to send to. The payee name is a courtesy and gates nothing. */
export function isPayableFor(s: BitSettings, plan: PlanKey): boolean {
  return s.qr[plan] !== null || s.number !== null;
}

/** True when at least one plan can be paid for at all — for the owner's
 *  settings screen, which is asking a different question than the checkout. */
export function isPayable(s: BitSettings): boolean {
  return s.number !== null || PLAN_KEYS.some(k => s.qr[k] !== null);
}

function fromEnv(): BitSettings {
  return normalizeBit({
    number: process.env.NEXT_PUBLIC_BIT_NUMBER,
    payee: process.env.NEXT_PUBLIC_BIT_PAYEE,
  });
}

/** What the checkout should show. Never throws — a settings table that cannot
 *  be read must leave the page saying "not available", not 500. */
export async function getBitSettings(): Promise<BitSettings> {
  const env = fromEnv();
  // The table is always consulted now: the QR codes live only there, so an
  // environment-configured number must not short-circuit the read.
  if (!isSupabaseConfigured()) return env;

  try {
    const { data, error } = await createServerSupabaseClient()
      .from('app_settings')
      .select('value')
      .eq('key', KEY)
      .maybeSingle();
    if (error) throw error;
    const stored = normalizeBit((data?.value ?? {}) as Record<string, unknown>);
    // Field by field, so a payee set in the environment survives a number that
    // is only in the table. QR codes only ever come from the table.
    return { number: stored.number ?? env.number, payee: stored.payee ?? env.payee, qr: stored.qr };
  } catch (err) {
    logger.warn('bit settings unavailable', { error: err instanceof Error ? err.message : String(err) });
    return env;
  }
}

/** Persist what the owner typed. Callers must have checked admin already. */
export async function saveBitSettings(next: BitSettings, updatedBy: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const { error } = await createServerSupabaseClient()
      .from('app_settings')
      .upsert({ key: KEY, value: next, updated_by: updatedBy, updated_at: new Date().toISOString() },
        { onConflict: 'key' });
    if (error) throw error;
    return true;
  } catch (err) {
    logger.error('bit settings write failed', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
