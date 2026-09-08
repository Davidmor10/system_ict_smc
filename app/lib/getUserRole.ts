import { auth, currentUser } from '@clerk/nextjs/server';
import { connection } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from './supabase/server';
import { effectiveRole } from './payments/access';
import { isOwnerEmail } from './coach-pipeline/auth/owners';
import { logger } from './logger';

// Four real tiers, strictly ranked deluxe ⊇ pro ⊇ starter ⊇ free.
//   free    — dashboard, journal, playbook, rules; NO AI Insight panel
//   starter — same pages as free, PLUS the AI Insight panel in the journal
//             (₪49/mo — cheap first paid step, kept minimal on purpose)
//   pro     — everything Starter has, PLUS the /dashboard/ai-analytics page
//             (₪99/mo — the "smart deal", where most users are meant to land)
//   deluxe  — everything Pro has, PLUS the /dashboard/coach (personal AI
//             coach) (₪199/mo)
export type Role = 'free' | 'starter' | 'pro' | 'deluxe';
export const ROLE_RANK: Record<Role, number> = { free: 0, starter: 1, pro: 2, deluxe: 3 };
export interface UserContext {
  role: Role;
  isOwner: boolean;
  /** False when the role could NOT be determined — a Clerk or Supabase call
   *  failed — as opposed to being determined to be 'free'.
   *
   *  The distinction is the whole point. Every failure path here used to
   *  return 'free', which is indistinguishable from a real answer, so a
   *  momentary outage in either service was reported to the caller as "this
   *  account has no plan". A paying trader then got 403 "upgrade required" on
   *  a feature they had paid for, their answer to the coach's question was
   *  thrown away, and the log said `role: free` — describing a downgrade that
   *  never happened as though it were the account's actual state.
   *
   *  Observed in production: four POSTs to the coach answer route logged
   *  plan_denied with role 'free', while five sibling routes behind the same
   *  'pro' gate answered 200 for the same session three minutes later.
   *
   *  Callers must fail closed on `false` — never grant on an unknown role —
   *  but they must say "try again", not "you need to upgrade". */
  resolved: boolean;
}

// Owner emails grant the top tier server-side regardless of billing state
// (plan access only, never an admin surface). The list is imported rather
// than retyped: coach-pipeline/auth/owners.ts says outright that it is the
// one list in the codebase, and this file quietly held a second copy of it.
export { isOwnerEmail };

/** Normalizes a raw stored value to a known Role, defaulting to 'free'. */
export function normalizeRole(v: unknown): Role {
  return v === 'deluxe' ? 'deluxe'
       : v === 'pro'    ? 'pro'
       : v === 'starter' ? 'starter'
       : 'free';
}

// Resolve the current user's role from the `profiles` table (keyed by Clerk ID).
// Defensive by design: if Clerk/Supabase aren't configured or the user isn't
// signed in, returns 'free' so the app stays usable rather than erroring.
export async function getUserRole(): Promise<Role> {
  const { role } = await getUserContext();
  return role;
}

/** Marks a context as "we could not tell". Separate from a resolved 'free'. */
function unresolved(): UserContext {
  return { role: 'free', isOwner: false, resolved: false };
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
  } catch (err) {
    // Clerk is configured and its session lookup failed. That is not a signed
    // out visitor; it is no answer at all.
    logger.warn('role lookup: clerk auth() failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return unresolved();
  }

  // A genuine answer: nobody is signed in, so the role really is free.
  if (!userId) return { role: 'free', isOwner: false, resolved: true };

  // Owner override — grants the top tier even when Supabase isn't configured.
  //
  // This is a second network call, to Clerk's backend API, and it can fail on
  // its own. When it did, the old code fell through with no log and the owner
  // was served whatever `profiles.role` happened to say — 'free', since an
  // owner never buys a subscription. The email on the profiles row is the
  // second source of the same fact, and the nightly worker has always used it
  // for exactly this reason, so the failure below is recoverable rather than
  // fatal.
  let clerkLookupFailed = false;
  try {
    const user = await currentUser();
    if (isOwnerEmail(user?.primaryEmailAddress?.emailAddress)) {
      return { role: 'deluxe', isOwner: true, resolved: true };
    }
  } catch (err) {
    clerkLookupFailed = true;
    logger.warn('role lookup: clerk currentUser() failed, falling back to the profiles row', {
      userId, error: err instanceof Error ? err.message : String(err),
    });
  }

  // Supabase is the only remaining source. If Clerk already failed and this
  // is unavailable too, there is nothing left to read the role from.
  if (!isSupabaseConfigured()) {
    return clerkLookupFailed ? unresolved() : { role: 'free', isOwner: false, resolved: true };
  }

  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('role, access_until, email')
      .eq('clerk_id', userId)
      .maybeSingle();

    // A failed read is not a free account. Returning one denied paid features
    // to paying users every time this query hiccupped.
    if (error) {
      logger.warn('role lookup: profiles read failed', { userId, error: error.message });
      return unresolved();
    }

    // NO ROW: the account exists in Clerk and nowhere else. Create it.
    //
    // The row was only ever written by the `user.created` webhook, which makes
    // a best-effort delivery from a third party the single point of failure
    // for whether an account exists at all. When it does not fire — a wrong
    // signing secret, a webhook pointed at the wrong instance, a delivery lost
    // — the trader signs in successfully and lands on a permanent "no plan"
    // screen, because there is nothing to read a plan from. Granting them one
    // by email is impossible too: the row the grant would update is the row
    // that was never written.
    //
    // Seen exactly that way: a tester signed up, the grant matched zero rows,
    // and nothing on any screen said why.
    //
    // So the read path heals it. Free tier, which is what a signed-in account
    // with no subscription is anyway, so this grants nothing — it only makes
    // the account addressable. The webhook stays the fast path; this is the
    // floor under it. `ignoreDuplicates` keeps a race with the webhook, or
    // with a second tab, from overwriting a role that was just set.
    if (!data) {
      try {
        const email = (await currentUser())?.primaryEmailAddress?.emailAddress ?? null;
        await supabase
          .from('profiles')
          .upsert({ clerk_id: userId, email, role: 'free' }, { onConflict: 'clerk_id', ignoreDuplicates: true });
      } catch {
        // A failed heal costs nothing this request did not already lack.
      }
      return { role: 'free', isOwner: false, resolved: true };
    }

    const row = data as { role?: unknown; access_until?: string | null; email?: string | null };

    // The owner, recognised from the row rather than from Clerk. Same rule the
    // nightly worker uses, and the reason a Clerk outage above is survivable.
    if (isOwnerEmail(row.email)) return { role: 'deluxe', isOwner: true, resolved: true };

    // Through the expiry, not straight off the column. A Bit transfer buys one
    // month; once access_until is past the account is free again, whatever the
    // stored role still says. Null means no expiry — see lib/payments/access.
    return { role: effectiveRole(row.role, row.access_until), isOwner: false, resolved: true };
  } catch (err) {
    logger.warn('role lookup: profiles query threw', {
      userId, error: err instanceof Error ? err.message : String(err),
    });
    return unresolved();
  }
}

/** The current Clerk session id, or null. Same defensive shape as
 *  getUserContext: never throws, and stays null when Clerk is unconfigured.
 *
 *  Used to scope the splash to a sign-in rather than to a browser session. */
export async function getSessionId(): Promise<string | null> {
  try {
    if (!process.env.CLERK_SECRET_KEY) return null;
    const { sessionId } = await auth();
    return sessionId ?? null;
  } catch {
    return null;
  }
}
