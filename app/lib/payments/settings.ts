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

const KEY = 'bit_payment';

export interface BitSettings {
  /** The phone number or handle a transfer is sent to. Null when unset. */
  number: string | null;
  /** Who the customer should see as the recipient. Null when unset. */
  payee: string | null;
}

export const EMPTY_BIT: BitSettings = { number: null, payee: null };

/** Trim, and treat blank as absent.
 *
 *  A settings form submits "" for a cleared field, and an empty string that
 *  reaches the checkout renders as a present-but-blank recipient — the same
 *  silent-misconfiguration shape the dash had. */
export function normalizeBit(input: { number?: unknown; payee?: unknown }): BitSettings {
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { number: clean(input.number), payee: clean(input.payee) };
}

/** True when a customer actually has somewhere to send money. The payee name
 *  is a courtesy; the number is what makes the page usable. */
export function isPayable(s: BitSettings): boolean {
  return s.number !== null;
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
  if (env.number) return env;
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
    // is only in the table.
    return { number: stored.number ?? env.number, payee: stored.payee ?? env.payee };
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
