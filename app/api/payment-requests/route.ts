import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit } from '../../lib/rateLimit';
import { logSecurityEvent } from '../../lib/securityLog';
import { logger } from '../../lib/logger';
import { viewerEmail, isAdminEmail } from '../../lib/payments/admin';
import { createRequest, listAllRequests } from '../../lib/payments/requests';
import { PLANS, isPlanKey, isVerificationValid } from '../../lib/payments/plans';
import { notifyOwner } from '../../lib/payments/notify';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().max(200),
  plan: z.string(),
});

/** GET /api/payment-requests — the verification queue. ADMIN ONLY.
 *
 *  Every row carries another customer's name and email address, so this is
 *  gated on the server and the gate fails closed. A non-admin gets 403 and no
 *  hint that there is anything to see. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/payment-requests GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isAdminEmail(await viewerEmail())) {
    logSecurityEvent('plan_denied', { route: '/api/payment-requests GET', role: 'non-admin', required: 'admin' });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const limited = checkRateLimit(`payreq:list:${userId}`, 60, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  return NextResponse.json({ requests: await listAllRequests() });
}

/** POST /api/payment-requests — a trader declares that they transferred.
 *
 *  The AMOUNT IS NOT TAKEN FROM THE CLIENT. The body names a plan and the
 *  price is looked up here, so a submitted request can never claim ₪1 for
 *  DELUXE — the owner approves against a number the server chose. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/payment-requests POST' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Deliberately tight. A person declares a transfer once a month; anything
  // faster is a stuck retry loop or somebody filling the owner's queue.
  const limited = checkRateLimit(`payreq:create:${userId}`, 5, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/payment-requests POST', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success || !isPlanKey(parsed.data.plan)) {
    logSecurityEvent('validation_failed', { route: '/api/payment-requests POST', userId });
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { fullName, email, plan } = parsed.data;
  // The same rule the button's enabled state uses, applied again here. The
  // button can be bypassed; this cannot.
  if (!isVerificationValid(fullName, email)) {
    return NextResponse.json({ error: 'Invalid name or email' }, { status: 400 });
  }

  const result = await createRequest({
    clerkId: userId,
    fullName: fullName.trim(),
    email: email.trim(),
    plan,
    amount: PLANS[plan].price,
  });

  if (!result.ok) {
    if (result.reason === 'duplicate') {
      return NextResponse.json({ error: 'already_pending' }, { status: 409 });
    }
    if (result.reason === 'unavailable') {
      return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Tell the owner. Awaited, not fire-and-forget: on Vercel the function can
  // be frozen the moment the response returns, which is exactly how the trades
  // mirror silently wrote nothing for a day. notifyOwner swallows its own
  // errors and never throws, so awaiting it cannot fail this request — the
  // payment is already recorded, and a customer must not be told their
  // submission failed because a mail provider was down.
  const notified = await notifyOwner({
    name: fullName.trim(),
    email: email.trim(),
    plan,
    amount: PLANS[plan].price,
    time: result.request.time,
  });

  logger.info('payment request received', {
    plan, amount: PLANS[plan].price, email: email.trim(), notified,
  });

  return NextResponse.json({ ok: true, request: result.request });
}
