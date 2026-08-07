// ─────────────────────────────────────────────────────────────────────────────
// Shared Supabase client accessor for the coach pipeline.
//
// Every DB helper in this folder pulls its client through here — so if we ever
// need to swap in a mock (tests), a read replica (perf), or add per-request
// tracing, one file changes.
//
// The client itself uses the SERVICE ROLE key (bypasses RLS by design; access
// control is enforced by every helper filtering on `clerk_id`). Never import
// this into client components.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '../../supabase/server';

let cached: SupabaseClient | null = null;

/** Returns the (memoized) service-role Supabase client. Throws if the env
    isn't configured — the caller should check `isCoachPipelineReady()` first
    when it wants to degrade gracefully. */
export function getClient(): SupabaseClient {
  if (cached) return cached;
  cached = createServerSupabaseClient();
  return cached;
}

/** For tests: inject a mock client. Callers restore by passing null. */
export function __setClientForTests(client: SupabaseClient | null): void {
  cached = client;
}

/** Compile-time-safe clerk_id guard. Every DB helper calls this first so a
    caller can't accidentally issue a "give me everyone's rows" query.
    A trimmed empty string is treated as missing. */
export function requireClerkId(clerkId: string | null | undefined): string {
  if (!clerkId || !clerkId.trim()) {
    throw new Error('coach-pipeline: clerk_id is required for every DB call');
  }
  return clerkId.trim();
}
