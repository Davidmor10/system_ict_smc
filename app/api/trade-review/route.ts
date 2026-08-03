// POST /api/trade-review — the client has already uploaded the video to
// Vercel Blob via /blob-upload and passes us the resulting URL. We validate
// the URL is one of ours, create the review row, and kick off the pipeline
// in the background. The pipeline transfers Blob → Gemini, waits ACTIVE,
// analyzes, and deletes the Blob.
//
// GET /api/trade-review?tradeId=N — list reviews for a trade.

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '../../lib/rateLimit';
import { logSecurityEvent } from '../../lib/securityLog';
import { logger } from '../../lib/logger';
import { createReview, listReviewsForTrade } from '../../lib/videoReview/reviewStore';
import { runReviewPipeline } from '../../lib/videoReview/pipeline';
import { isOwnBlobUrl } from '../../lib/videoReview/videoStorage';

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

  let body: { tradeId?: number; blobUrl?: string; mimeType?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { tradeId, blobUrl, mimeType } = body;
  if (!Number.isSafeInteger(tradeId)) return NextResponse.json({ error: 'Invalid tradeId' }, { status: 400 });
  if (typeof blobUrl !== 'string' || !isOwnBlobUrl(blobUrl)) {
    logSecurityEvent('validation_failed', { route: '/api/trade-review POST', userId, reason: 'blob_url_not_own' });
    return NextResponse.json({ error: 'Invalid blobUrl' }, { status: 400 });
  }
  if (typeof mimeType !== 'string' || !mimeType.startsWith('video/')) {
    return NextResponse.json({ error: 'Invalid mimeType' }, { status: 400 });
  }

  try {
    // storagePath here holds the Vercel Blob URL (single field, single
    // "where's the source video" concept, no schema churn).
    const row = await createReview(userId, tradeId as number, { storagePath: blobUrl, videoMime: mimeType });

    runReviewPipeline(row.id, userId).catch(err => {
      logger.error('runReviewPipeline background error', { reviewId: row.id, error: err instanceof Error ? err.message : String(err) });
    });

    return NextResponse.json({ review: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('trade-review POST failed', { userId, error: message });
    return NextResponse.json({ error: 'Failed to start review', detail: message }, { status: 500 });
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
