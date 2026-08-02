// POST /api/trade-review — the client has already uploaded the video to
// Supabase Storage. We validate ownership of the storage path, create the
// review row, and kick off the pipeline in the background. The pipeline
// itself is responsible for the Supabase→Gemini transfer, the ACTIVE wait,
// analysis, and Supabase cleanup.
//
// GET /api/trade-review?tradeId=N — list reviews for a trade.

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '../../lib/rateLimit';
import { logSecurityEvent } from '../../lib/securityLog';
import { logger } from '../../lib/logger';
import { createReview, listReviewsForTrade } from '../../lib/videoReview/reviewStore';
import { runReviewPipeline } from '../../lib/videoReview/pipeline';
import { ownsStoragePath } from '../../lib/videoReview/videoStorage';

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

  let body: { tradeId?: number; storagePath?: string; mimeType?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { tradeId, storagePath, mimeType } = body;
  if (!Number.isSafeInteger(tradeId)) return NextResponse.json({ error: 'Invalid tradeId' }, { status: 400 });
  if (typeof storagePath !== 'string' || !ownsStoragePath(userId, storagePath)) {
    // Rejecting a signed URL for another user's path is the whole security
    // model of this endpoint — flag it explicitly.
    logSecurityEvent('validation_failed', { route: '/api/trade-review POST', userId, reason: 'storage_path_ownership' });
    return NextResponse.json({ error: 'Invalid storagePath' }, { status: 400 });
  }
  if (typeof mimeType !== 'string' || !mimeType.startsWith('video/')) {
    return NextResponse.json({ error: 'Invalid mimeType' }, { status: 400 });
  }

  try {
    const row = await createReview(userId, tradeId as number, { storagePath, videoMime: mimeType });

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
