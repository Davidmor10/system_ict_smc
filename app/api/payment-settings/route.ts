// ─────────────────────────────────────────────────────────────────────────────
// GET/PUT /api/payment-settings — the Bit number customers pay into.
//
// ADMIN ONLY, AND THE WRITE IS THE REASON. The number is not a secret — every
// customer sees it — but whoever can set it decides where the money goes. So
// the gate is the same one the decision route uses: from the session, against
// the server's own allowlist, never from anything the caller sent.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail, viewerEmail } from '../../lib/payments/admin';
import { getBitSettings, normalizeBit, saveBitSettings } from '../../lib/payments/settings';
import { checkRateLimit } from '../../lib/rateLimit';
import { logSecurityEvent } from '../../lib/securityLog';
import { logger } from '../../lib/logger';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  number: z.string().max(60),
  payee: z.string().max(120),
});

async function requireAdmin(route: string): Promise<{ userId: string; email: string } | NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const email = await viewerEmail();
  if (!isAdminEmail(email)) {
    logSecurityEvent('plan_denied', { route, role: 'non-admin', required: 'admin', userId });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { userId, email: email ?? 'admin' };
}

export async function GET() {
  const gate = await requireAdmin('/api/payment-settings GET');
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ settings: await getBitSettings() });
}

export async function PUT(req: Request) {
  const gate = await requireAdmin('/api/payment-settings PUT');
  if (gate instanceof NextResponse) return gate;

  const limited = checkRateLimit(`paysettings:${gate.userId}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const next = normalizeBit(parsed.data);
  if (!await saveBitSettings(next, gate.email)) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  // Worth a line: this is the setting that decides where customers send money.
  logger.info('bit settings updated', { by: gate.email, hasNumber: next.number !== null });
  return NextResponse.json({ ok: true, settings: next });
}
