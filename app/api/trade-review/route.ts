// POST /api/trade-review — the client has already uploaded the video directly
// to Gemini via /upload-init + the returned resumable URL. All we get here is
// the resulting fileUri/mimeType/tradeId. We create the review row and kick
// off the analysis pipeline in the background (fire-and-forget).
//
// GET /api/trade-review?tradeId=N — list reviews for a trade.

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '../../lib/rateLimit';
import { logSecurityEvent } from '../../lib/securityLog';
import { logger } from '../../lib/logger';
import { createReview, listReviewsForTrade } from '../../lib/videoReview/reviewStore';
import { runReviewPipeline } from '../../lib/videoReview/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/trade-review POST' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`trade-review:post:${userId}`, 10, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/trade-review POST', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  let body: { tradeId?: number; fileUri?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { tradeId, fileUri, mimeType } = body;
  if (!Number.isSafeInteger(tradeId)) return NextResponse.json({ error: 'Invalid tradeId' }, { status: 400 });
  if (typeof fileUri !== 'string' || !fileUri.startsWith('https://generativelanguage.googleapis.com/')) {
    return NextResponse.json({ error: 'Invalid fileUri' }, { status: 400 });
  }
  if (typeof mimeType !== 'string' || !mimeType.startsWith('video/')) {
    return NextResponse.json({ error: 'Invalid mimeType' }, { status: 400 });
  }

  try {
    const row = await createReview(userId, tradeId as number, fileUri, mimeType);

    runReviewPipeline(row.id, userId).catch(err => {
      logger.error('runReviewPipeline background error', { reviewId: row.id, error: err instanceof Error ? err.message : String(err) });
    });

    return NextResponse.json({ review: row });
  } catch (err) {
    logger.error('trade-review POST failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Failed to start review' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tradeIdRaw = new URL(req.url).searchParams.get('tradeId');
  if (!tradeIdRaw) return NextResponse.json({ reviews: [] });
  const tradeId = Number(tradeIdRaw);
  if (!Number.isSafeInteger(tradeId)) return NextResponse.json({ error: 'Invalid tradeId' }, { status: 400 });

  const reviews = await listReviewsForTrade(userId, tradeId);
  return NextResponse.json({ reviews });
}
