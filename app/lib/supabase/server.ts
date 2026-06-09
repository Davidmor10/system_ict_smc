import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Server-side Supabase client using the SERVICE ROLE key — bypasses RLS for
// trusted server operations (role lookups, webhook profile creation).
// Never import this into client components.

const url        = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isSupabaseConfigured(): boolean {
  return !!(url && serviceKey);
}

export function createServerSupabaseClient(): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error(
      'Supabase env vars missing — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
