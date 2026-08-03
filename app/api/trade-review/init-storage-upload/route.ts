// POST /api/trade-review/init-storage-upload
// Client asks for a signed upload URL, then PUTs the video bytes directly to
// Supabase Storage (bypasses Vercel's 4.5MB request-body cap AND Google's
// no-CORS-on-uploads problem in one move).

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logger } from '../../../lib/logger';
import { createUploadUrl, MAX_VIDEO_BYTES } from '../../../lib/videoReview/videoStorage';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limited = checkRateLimit(`trade-review:init-storage:${userId}`, 20, 60_000);
  if (!limited.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  let body: { mimeType?: string; sizeBytes?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { mimeType, sizeBytes } = body;
  if (!mimeType || !mimeType.startsWith('video/')) {
    return NextResponse.json({ error: 'Only video uploads are accepted' }, { status: 400 });
  }
  if (typeof sizeBytes !== 'number' || sizeBytes <= 0 || sizeBytes > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: `Video must be ≤ ${MAX_VIDEO_BYTES / (1024 * 1024)} MB` }, { status: 413 });
  }

  try {
    const { uploadUrl, storagePath, token } = await createUploadUrl(userId, mimeType);
    return NextResponse.json({ uploadUrl, storagePath, token });
  } catch (err) {
    // The message is the trader's own configuration state (missing bucket,
    // permission issue) — no sensitive data in it, so surface it. Blanket
    // "Failed to prepare upload" was untraceable without Vercel Function
    // logs the trader can't see.
    const message = err instanceof Error ? err.message : String(err);
    logger.error('init-storage-upload failed', { userId, error: message });
    return NextResponse.json({ error: 'Failed to prepare upload', detail: message }, { status: 500 });
  }
}
