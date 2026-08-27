import { Webhook } from 'svix';
import type { WebhookEvent } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  isSupabaseConfigured,
} from '../../../lib/supabase/server';

// Clerk → Supabase provisioning. On `user.created` we insert a row in
// `profiles` defaulting to the 'free' role; on `user.deleted` we delete
// everything the account wrote — see below.
// The endpoint is signature-verified with svix and never trusts an unsigned body.

// ─────────────────────────────────────────────────────────────────────────────
// Deleting an account deletes what the account wrote.
//
// This used to remove the `profiles` row and nothing else. Everything the
// trader had ever written stayed: every trade, every notebook entry and its
// embeddings, every daily insight, their behaviour findings, their chat
// history with the coach, their rules, setups and weekly reports. Twenty-four
// tables are keyed by clerk_id; account deletion cleared one of them.
//
// Found by tracing ten journal rows belonging to a clerk_id with no profile —
// an account somebody deleted, whose journal is still sitting in the database.
//
// ORDER MATTERS. Children first, because a foreign key with `on delete
// cascade` only helps when the parent goes, and two of these tables reference
// rows in others. `profiles` goes LAST on purpose: while it exists the purge
// is unfinished, so an interrupted run leaves a marker the retry can act on.
//
// EVERY TABLE IS ATTEMPTED. One failing table must not abort the rest — a
// purge that stops at the first error leaves an arbitrary half of someone's
// data behind and never says which half. Failures are collected and reported,
// and the caller answers Clerk with a 500 so the whole thing runs again.
// ─────────────────────────────────────────────────────────────────────────────

/** Everything keyed to a trader, children before parents. */
const USER_TABLES = [
  // notebook: chunks reference entries
  'notebook_chunks', 'notebook_entries',
  // behaviour: events reference findings
  'behavior_finding_events', 'behavior_findings',
  // journal and its mirror
  'rule_violations', 'journal_trades', 'intelligence_trades', 'trades',
  // the trader's own definitions
  'trading_rules', 'setups', 'user_collections', 'user_preferences',
  // everything the AI produced about them
  'daily_insights', 'weekly_ai_reports', 'ai_insight_history',
  'trader_hypotheses', 'trader_profiles', 'user_profile', 'pattern_memory',
  'coach_chats', 'coach_generation_fallback',
  // operational rows carrying their id
  'processing_jobs', 'rate_limits', 'ai_usage_log',
  // last: while this row exists, the purge is unfinished
  'profiles',
] as const;

/** Delete every row belonging to one trader. Returns the tables that failed.
 *
 *  A table the database does not have is not a failure — this app ships ahead
 *  of its migrations by design, and refusing to purge because one optional
 *  table is missing would keep the rest of someone's data forever. */
async function purgeUser(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  clerkId: string,
): Promise<string[]> {
  const failed: string[] = [];
  for (const table of USER_TABLES) {
    const { error } = await supabase.from(table).delete().eq('clerk_id', clerkId);
    // 42P01: relation does not exist. PGRST205: unknown table in the schema cache.
    if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
      console.error('[clerk-webhook] purge failed', { table, code: error.code, message: error.message });
      failed.push(table);
    }
  }
  return failed;
}

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    console.error('[clerk-webhook] CLERK_WEBHOOK_SIGNING_SECRET is not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
  }

  // Verify against the RAW body — re-serializing JSON would break the signature.
  const payload = await req.text();

  let evt: WebhookEvent;
  try {
    evt = new Webhook(secret).verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as WebhookEvent;
  } catch (err) {
    console.error('[clerk-webhook] signature verification failed', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    console.warn('[clerk-webhook] Supabase not configured — event acknowledged but not persisted');
    return NextResponse.json({ ok: true, persisted: false });
  }

  const supabase = createServerSupabaseClient();

  try {
    switch (evt.type) {
      case 'user.created': {
        const email = evt.data.email_addresses?.[0]?.email_address ?? null;
        const { error } = await supabase
          .from('profiles')
          .upsert({ clerk_id: evt.data.id, email, role: 'free' }, { onConflict: 'clerk_id' });
        if (error) throw error;
        break;
      }
      case 'user.deleted': {
        if (evt.data.id) {
          const failed = await purgeUser(supabase, evt.data.id);
          // A partial purge must not be acknowledged. Clerk retries on a 500,
          // and every delete here is idempotent, so the retry finishes what
          // this pass could not.
          if (failed.length) {
            console.error('[clerk-webhook] purge incomplete', { tables: failed });
            return NextResponse.json({ error: 'Purge incomplete' }, { status: 500 });
          }
        }
        break;
      }
      default:
        // Other event types are acknowledged without action.
        break;
    }
  } catch (err) {
    console.error('[clerk-webhook] persistence error', err);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, persisted: true });
}

// ── exports for tests ───────────────────────────────────────────────────────
export const __testing = { USER_TABLES };
