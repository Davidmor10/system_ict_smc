import { auth, currentUser } from '@clerk/nextjs/server';
import { connection } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from './supabase/server';

// Three real tiers. Access is strictly ranked: deluxe ⊇ pro ⊇ free.
//   free   — dashboard, journal, setups (playbook) and rules, all without
//            the paid AI tools (e.g. the journal's AI insight panel)
//   pro    — adds the AI tools embedded in those free-tier pages
//   deluxe — everything (adds statistics, AI analytics and the AI coach)
export type Role = 'free' | 'pro' | 'deluxe';
export const ROLE_RANK: Record<Role, number> = { free: 0, pro: 1, deluxe: 2 };
export interface UserContext { role: Role; isOwner: boolean; }

// Owner emails — always granted the top tier server-side, regardless of
// Supabase/billing state (this is plan access only, not any admin surface).
const OWNER_EMAILS = ['davidmor030908@gmail.com', 'davidmor030909@gmail.com'];

/** Normalizes a raw stored value to a known Role, defaulting to 'free'. */
export function normalizeRole(v: unknown): Role {
  return v === 'deluxe' ? 'deluxe' : v === 'pro' ? 'pro' : 'free';
}

// Resolve the current user's role from the `profiles` table (keyed by Clerk ID).
// Defensive by design: if Clerk/Supabase aren't configured or the user isn't
// signed in, returns 'free' so the app stays usable rather than erroring.
export async function getUserRole(): Promise<Role> {
  const { role } = await getUserContext();
  return role;
}

export async function getUserContext(): Promise<UserContext> {
  // Force per-request evaluation. Without this, a build that runs with
  // CLERK_SECRET_KEY unset never touches a request-time API on this path
  // (the env check below short-circuits before auth() reads headers), so
  // Next would happily prerender the gated dashboard segments with the
  // build-time role baked in. connection() stalls prerendering here and
  // guarantees the role — and every requirePlan() gate built on it — is
  // resolved on the live request, regardless of the build environment.
  await connection();

  let userId: string | null = null;

  try {
    if (process.env.CLERK_SECRET_KEY) {
      const session = await auth();
      userId = session.userId;
    }
  } catch {
    userId = null;
  }

  if (!userId) return { role: 'free', isOwner: false };

  // Owner override — grants the top tier even when Supabase isn't configured.
  try {
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
    if (email && OWNER_EMAILS.includes(email)) {
      return { role: 'deluxe', isOwner: true };
    }
  } catch {
    // Fall through to the Supabase lookup below.
  }

  if (!isSupabaseConfigured()) return { role: 'free', isOwner: false };

  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('clerk_id', userId)
      .maybeSingle();

    if (error || !data) return { role: 'free', isOwner: false };
    return { role: normalizeRole(data.role), isOwner: false };
  } catch {
    return { role: 'free', isOwner: false };
  }
}
