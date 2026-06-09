import { auth } from '@clerk/nextjs/server';
import { createServerSupabaseClient, isSupabaseConfigured } from './supabase/server';

export type Role = 'free' | 'pro';

// Resolve the current user's role from the `profiles` table (keyed by Clerk ID).
// Defensive by design: if Clerk/Supabase aren't configured or the user isn't
// signed in, returns 'free' so the app stays usable rather than erroring.
export async function getUserRole(): Promise<Role> {
  let userId: string | null = null;

  try {
    if (process.env.CLERK_SECRET_KEY) {
      const session = await auth();
      userId = session.userId;
    }
  } catch {
    userId = null;
  }

  if (!userId || !isSupabaseConfigured()) return 'free';

  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('clerk_id', userId)
      .maybeSingle();

    if (error || !data) return 'free';
    return data.role === 'pro' ? 'pro' : 'free';
  } catch {
    return 'free';
  }
}
