import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../../../lib/supabase/server';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { logSecurityEvent } from '../../../../lib/securityLog';
import { logger } from '../../../../lib/logger';
import { viewerEmail, isAdminEmail } from '../../../../lib/payments/admin';
import { decideRequest } from '../../../../lib/payments/requests';
import { PLANS } from '../../../../lib/payments/plans';
import { grantForApproval } from '../../../../lib/payments/grant';

export const dynamic = 'force-dynamic';

/** POST /api/payment-requests/[id]/decision — approve or reject. ADMIN ONLY.
 *
 *  This route grants paid access, so the admin check is the load-bearing line
 *  in the file. It is made here, from the session, against the server's own
 *  allowlist — never from anything the caller sent. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/payment-requests/[id]/decision' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = await viewerEmail();
  if (!isAdminEmail(email)) {
    // Worth a log line: a signed-in account reaching this route is either a
    // stale admin session or somebody trying the URL.
    logSecurityEvent('plan_denied', {
      route: '/api/payment-requests/[id]/decision', role: 'non-admin', required: 'admin', userId,
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const limited = checkRateLimit(`payreq:decide:${userId}`, 60, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const status = (raw as { status?: unknown })?.status;
  if (status !== 'approved' && status !== 'rejected') {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const { id } = await params;
  const decision = await decideRequest(id, status, email ?? 'admin');
  if (!decision.ok) {
    // Already decided, or no such row. Not an error the owner needs to see as
    // a failure — the panel refetches and shows the settled state.
    return NextResponse.json({ error: 'not_pending' }, { status: 409 });
  }

  if (status === 'approved' && decision.clerkId && decision.plan && isSupabaseConfigured()) {
    const plan = PLANS[decision.plan];
    try {
      const supabase = createServerSupabaseClient();

      // A RENEWAL EXTENDS; IT DOES NOT RESET. Writing "today plus a month"
      // unconditionally took back whatever the customer had left — pay a week
      // early and that week was gone. Read what they still hold and add to it.
      const { data: current } = await supabase
        .from('profiles')
        .select('access_until, role')
        .eq('clerk_id', decision.clerkId)
        .maybeSingle();
      const held = current as { access_until?: string | null; role?: unknown } | null;

      // ...but a RETRY of an already-approved row must not extend anything.
      // lib/payments/grant says why, and it is the only place that decides.
      const grant = grantForApproval({
        alreadyDecided: decision.alreadyDecided === true,
        currentAccessUntil: held?.access_until,
        currentRole: held?.role,
      });

      if (grant.write) {
        // Upsert, not update. The profiles row is normally there, but an
        // account whose provisioning webhook never fired would silently be
        // approved into nothing — money taken, access still closed.
        const { error } = await supabase
          .from('profiles')
          .upsert(
            {
              clerk_id: decision.clerkId,
              role: plan.role,
              subscription_status: 'active',
              access_until: grant.until.toISOString(),
            },
            { onConflict: 'clerk_id' },
          );
        if (error) throw error;
      }
    } catch (err) {
      // The request is already marked approved, so failing here would leave
      // the owner believing access was opened when it was not. Report it.
      logger.error('approval could not open access', {
        id, clerkId: decision.clerkId, error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json({ error: 'decided_but_access_failed' }, { status: 500 });
    }
  }

  // `alreadyDecided` says the row had been decided before and this call
  // re-ran the access grant — the recovery path for an approval that once
  // failed halfway. The panel shows the same settled row either way.
  return NextResponse.json({ ok: true, status, repaired: decision.alreadyDecided === true });
}
