// POST /api/trade-review/upload-init — starts a Gemini File API resumable upload
// session and returns the signed URL the browser can PUT the video bytes to
// directly. This is the workaround for Vercel's 4.5 MB serverless body limit:
// the video never touches our server, only its metadata does.

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { logger } from '../../../lib/logger';

export const runtime = 'nodejs';

// Gemini File API caps at 2GB; we cap at 500MB to keep the analysis window
// reasonable (5-15 minute trade reviews max).
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limited = checkRateLimit(`trade-review:upload-init:${userId}`, 20, 60_000);
  if (!limited.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'AI provider not configured' }, { status: 500 });

  let body: { mimeType?: string; sizeBytes?: number; displayName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const mimeType = body.mimeType;
  const sizeBytes = body.sizeBytes;
  if (!mimeType || !mimeType.startsWith('video/')) {
    return NextResponse.json({ error: 'Only video uploads are accepted' }, { status: 400 });
  }
  if (typeof sizeBytes !== 'number' || sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `Video must be ≤ ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB` }, { status: 413 });
  }

  try {
    // Ask Gemini's File API to open a resumable upload session. The returned
    // X-Goog-Upload-URL is a signed, single-use URL — safe to hand to the
    // browser (no API key required to complete the upload).
    const initRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(sizeBytes),
          'X-Goog-Upload-Header-Content-Type': mimeType,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: body.displayName ?? `trade-review-${Date.now()}` } }),
      },
    );

    if (!initRes.ok) {
      const detail = await initRes.text();
      logger.error('gemini upload init failed', { userId, status: initRes.status, detail: detail.slice(0, 500) });
      return NextResponse.json({ error: 'Failed to start upload session' }, { status: 502 });
    }

    const uploadUrl = initRes.headers.get('x-goog-upload-url') ?? initRes.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) {
      logger.error('gemini upload init: no upload URL in response', { userId });
      return NextResponse.json({ error: 'No upload URL from AI provider' }, { status: 502 });
    }

    return NextResponse.json({ uploadUrl });
  } catch (err) {
    logger.error('upload-init error', { userId, error: err instanceof Error ? err.message : String(err) });
    logSecurityEvent('validation_failed', { route: '/api/trade-review/upload-init', userId });
    return NextResponse.json({ error: 'Upload init failed' }, { status: 500 });
  }
}
