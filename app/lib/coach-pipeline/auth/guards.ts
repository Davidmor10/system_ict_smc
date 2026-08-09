// ─────────────────────────────────────────────────────────────────────────────
// Shared auth guards for the coach pipeline's operational endpoints.
//
// Two audiences, two guards:
//   - Vercel Cron       → assertCronAuth (bearer CRON_SECRET)
//   - The account owner → assertOwner    (Clerk email allowlist)
//
// Both live here so the owner list exists once instead of being copy-pasted
// into every diagnostic route (a drifting allowlist is a silent hole).
// ─────────────────────────────────────────────────────────────────────────────

import { timingSafeEqual } from 'crypto';
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { logSecurityEvent } from '../../securityLog';
import { OWNER_EMAILS, isOwnerEmail } from './owners';

export { OWNER_EMAILS, isOwnerEmail };

/** Constant-time string compare that doesn't leak length through early exit.
 *  Hashes both sides to a fixed width first so unequal lengths are safe. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so the branch isn't a timing oracle by itself.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Gate for /api/cron/*. Returns a NextResponse to short-circuit with, or null
 *  when the caller is authorized.
 *
 *  FAILS CLOSED: a missing CRON_SECRET rejects every request. The previous
 *  behavior (allow + warn) meant a deploy that forgot the variable shipped
 *  publicly-triggerable AI spend. A 503 is loud; an open endpoint is silent. */
export function assertCronAuth(req: Request, route: string): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logSecurityEvent('auth_failed', { route, reason: 'cron_secret_unset' });
    return NextResponse.json(
      { error: 'Cron authentication is not configured' },
      { status: 503 },
    );
  }

  const header = req.headers.get('authorization') ?? '';
  if (!safeEqual(header, `Bearer ${secret}`)) {
    logSecurityEvent('auth_failed', { route, reason: 'bad_cron_bearer' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

/** Gate for owner-only diagnostic routes. Returns the owner's clerk userId on
 *  success, or a NextResponse to short-circuit with. */
export async function assertOwner(
  route: string,
): Promise<{ userId: string } | NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user  = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!isOwnerEmail(email)) {
    logSecurityEvent('auth_failed', { route, userId, reason: 'not_owner' });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { userId };
}
