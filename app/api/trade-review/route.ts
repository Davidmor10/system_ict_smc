// POST /api/trade-review — upload a trade-review video and kick off the pipeline.
// Body: multipart form with `video` (File), `tradeId` (number). Returns the
// created review row so the client can start polling GET /api/trade-review/[id].
//
// The upload + Gemini file-processing wait happens synchronously (needed to get
// a fileUri before the pipeline can start), but the analysis pipeline runs in
// the background so the HTTP request returns as soon as the video is queued.
//
// GET /api/trade-review?tradeId=N — list reviews for a trade.

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '../../lib/rateLimit';
import { logSecurityEvent } from '../../lib/securityLog';
import { logger } from '../../lib/logger';
import { createReview, listReviewsForTrade } from '../../lib/videoReview/reviewStore';
import { uploadVideoToGemini, runReviewPipeline } from '../../lib/videoReview/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Cap uploads at 200 MB — a typical trade-review clip is 10-60 MB, and the
// Gemini File API itself limits at 2 GB. This is our own guardrail.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const ALLOWED_MIME_PREFIX = 'video/';

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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const video = form.get('video');
  const tradeIdRaw = form.get('tradeId');
  if (!(video instanceof Blob)) return NextResponse.json({ error: 'Missing video' }, { status: 400 });
  if (!tradeIdRaw) return NextResponse.json({ error: 'Missing tradeId' }, { status: 400 });

  const tradeId = Number(tradeIdRaw);
  if (!Number.isSafeInteger(tradeId)) {
    return NextResponse.json({ error: 'Invalid tradeId' }, { status: 400 });
  }
  if (video.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Video exceeds 200 MB limit' }, { status: 413 });
  }
  const mime = video.type || 'video/mp4';
  if (!mime.startsWith(ALLOWED_MIME_PREFIX)) {
    return NextResponse.json({ error: 'Only video uploads are accepted' }, { status: 400 });
  }

  try {
    const { fileUri, mimeType } = await uploadVideoToGemini(video, mime);
    const row = await createReview(userId, tradeId, fileUri, mimeType);

    // Fire-and-forget the pipeline; the row's status will progress and the
    // client polls the GET endpoint below.
    runReviewPipeline(row.id, userId).catch(err => {
      logger.error('runReviewPipeline background error', { reviewId: row.id, error: err instanceof Error ? err.message : String(err) });
    });

    return NextResponse.json({ review: row });
  } catch (err) {
    logger.error('trade-review POST failed', { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Upload failed', detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
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
