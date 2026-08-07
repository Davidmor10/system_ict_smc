// ─────────────────────────────────────────────────────────────────────────────
// user_profile access — the Rolling Profile. This is the ONE thing every AI
// call in the pipeline reads, so upsert enforces the token cap in code before
// hitting Supabase (which has its own DB-level CHECK as a backstop).
// ─────────────────────────────────────────────────────────────────────────────

import { T, type UserProfileRow, type Statistical, type Behavioral } from '../types';
import { getClient, requireClerkId } from './client';
import { assertProfileWithinCap } from '../tokens';

/** Load a user's profile. Returns null for a brand-new user with no row yet —
    the caller must be able to run without a profile (cold-start path). */
export async function getUserProfile(clerkId: string): Promise<UserProfileRow | null> {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient()
    .from(T.userProfile)
    .select('*')
    .eq('clerk_id', cid)
    .maybeSingle();
  if (error) throw error;
  return (data as UserProfileRow | null) ?? null;
}

/** Fields that make up a fresh profile write. Watermarks are included so a
    successful refresh advances them atomically with the content. */
export interface ProfileUpsert {
  statistical:            Statistical;
  behavioral:             Behavioral;
  narrative_summary:      string;
  schema_version:         number;
  analyzer_version:       number;
  last_analyzed_at:       Date;
  last_trade_included_id: string | null;
  last_note_included_id:  string | null;
}

/** Save or replace a user's profile. Enforces the 500-token cap *before*
    writing (throws ProfileOverCapError on breach). The DB has its own CHECK
    constraint as a last line of defense — this early check gives the pipeline
    a chance to log + keep the old profile intact rather than eating a SQL
    error mid-transaction. */
export async function upsertUserProfile(
  clerkId: string,
  input: ProfileUpsert,
): Promise<UserProfileRow> {
  const cid    = requireClerkId(clerkId);
  const tokens = assertProfileWithinCap({
    statistical:       input.statistical,
    behavioral:        input.behavioral,
    narrative_summary: input.narrative_summary,
  });

  const row = {
    clerk_id:               cid,
    statistical:            input.statistical,
    behavioral:             input.behavioral,
    narrative_summary:      input.narrative_summary,
    profile_token_count:    tokens,
    schema_version:         input.schema_version,
    analyzer_version:       input.analyzer_version,
    last_analyzed_at:       input.last_analyzed_at.toISOString(),
    last_trade_included_id: input.last_trade_included_id,
    last_note_included_id:  input.last_note_included_id,
    updated_at:             new Date().toISOString(),
  };

  const { data, error } = await getClient()
    .from(T.userProfile)
    .upsert(row, { onConflict: 'clerk_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data as UserProfileRow;
}

/** Trigger-check helper: how long since the profile last ran, and how many
    fresh trades have accumulated. Used by the pipeline's decision logic
    ("refresh if >= 5 new trades OR >= 6 hours since last run"). Pure — no
    computation, just fetches. Returns nulls when the profile doesn't exist
    (cold start — caller should treat as "always refresh"). */
export async function getRefreshSignals(clerkId: string): Promise<{
  lastAnalyzedAt: Date | null;
  hoursSinceLast: number | null;
} | null> {
  const p = await getUserProfile(clerkId);
  if (!p) return null;
  const last = new Date(p.last_analyzed_at);
  const ms   = Date.now() - last.getTime();
  return { lastAnalyzedAt: last, hoursSinceLast: ms / (1000 * 60 * 60) };
}
