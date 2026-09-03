// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payment-requests/mine — the caller's own latest request.
//
// The customer's status card was rendered once, from the server, at page load.
// The owner then approves or rejects in the admin panel and the customer's
// screen keeps saying "ממתין לאימות" until they happen to reload — which for
// a rejection means they sit waiting for access that is never coming, and for
// an approval means they paid and were shown nothing.
//
// SCOPED TO THE SESSION, NOT TO A PARAMETER. It takes no id: the row is looked
// up by the caller's own clerk_id, so there is nothing to tamper with and no
// way to read somebody else's request by guessing.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { latestRequestFor } from '../../../lib/payments/requests';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { logger } from '../../../lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/payment-requests/mine' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Generous: this is polled while a request is pending, and the poll stops on
  // its own the moment a decision lands.
  const limited = checkRateLimit(`payreq:mine:${userId}`, 120, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  try {
    return NextResponse.json({ request: await latestRequestFor(userId) });
  } catch (err) {
    logger.error('own payment request lookup failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ request: null });
  }
}
