import { auth, currentUser } from '@clerk/nextjs/server';
import { createServerSupabaseClient, isSupabaseConfigured } from './supabase/server';

export type Role = 'free' | 'pro';
export interface UserContext { role: Role; isOwner: boolean; }

// Emails always granted Pro server-side, regardless of Supabase/billing state.
// Mirrors the client-side override in app/hooks/usePlan.ts.
const PRO_OVERRIDE_EMAILS = ['davidmor030908@gmail.com'];

// Resolve the current user's role from the `profiles` table (keyed by Clerk ID).
// Defensive by design: if Clerk/Supabase aren't configured or the user isn't
// signed in, returns 'free' so the app stays usable rather than erroring.
export async function getUserRole(): Promise<Role> {
  const { role } = await getUserContext();
  return role;
}

export async function getUserContext(): Promise<UserContext> {
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

  // Email override — grants Pro even when Supabase isn't configured yet.
  try {
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
    if (email && PRO_OVERRIDE_EMAILS.includes(email)) {
      return { role: 'pro', isOwner: true };
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
    return { role: data.role === 'pro' ? 'pro' : 'free', isOwner: false };
  } catch {
    return { role: 'free', isOwner: false };
  }
}
