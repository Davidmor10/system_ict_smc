// POST /api/trade-review/blob-upload
//
// Two-phase handler wired through @vercel/blob's handleUpload:
//   Phase 1 — "generate-client-token": the browser's upload() call asks us
//             for a scoped token so it can PUT the video directly to Vercel
//             Blob without touching our serverless function's 4.5MB body cap.
//             We validate the caller and set the size/mime constraints on the
//             token so an authenticated user still can't upload arbitrarily
//             large or wrong-type files.
//   Phase 2 — "upload-completed": Vercel's callback after the upload finishes.
//             We just log — the client explicitly POSTs to /api/trade-review
//             immediately after the upload to kick off the analysis pipeline,
//             which is the ONLY code path that starts a review. Keeping both
//             signals in play (client-explicit + Vercel callback) would risk
//             double-firing the pipeline.

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logger } from '../../../lib/logger';
import { MAX_VIDEO_BYTES, BLOB_PREFIX } from '../../../lib/videoReview/videoStorage';

export const runtime = 'nodejs';

/** GET diagnostic — hit /api/trade-review/blob-upload in a browser to check
    whether BLOB_READ_WRITE_TOKEN actually reached the deployed function.
    Without this, a missing token surfaces on the client as an opaque
    "Failed to retrieve the client token" that could mean anything. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return NextResponse.json({
    hasToken: !!token,
    tokenPrefix: token ? token.slice(0, 30) + '…' : null,
    hint: token
      ? 'Token present — if uploads still fail, the token may be invalid or the store may not be connected to this project.'
      : 'BLOB_READ_WRITE_TOKEN is missing on this deployment. Reconnect the Blob store in Vercel Dashboard → Storage → your Blob store → Connect Project → then trigger a redeploy.',
  });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limited = checkRateLimit(`trade-review:blob-upload:${userId}`, 20, 60_000);
  if (!limited.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  // handleUpload reads BLOB_READ_WRITE_TOKEN from the env by default; when
  // it's missing, its failure surfaces on the client as the opaque
  // "Failed to retrieve the client token". Catch the missing case here so
  // the trader can see what's actually wrong.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    logger.error('blob-upload: BLOB_READ_WRITE_TOKEN missing at runtime', { userId });
    return NextResponse.json({
      error: 'Blob storage not configured',
      detail: 'BLOB_READ_WRITE_TOKEN is missing. Connect the Vercel Blob store to this project (Dashboard → Storage → your store → Connect Project) and redeploy.',
    }, { status: 500 });
  }

  let body: HandleUploadBody;
  try { body = await req.json() as HandleUploadBody; } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async pathname => {
        // Namespacing check — the client picks the pathname but we enforce
        // that it lives under our review prefix so this token can't be used
        // to write anywhere else in the store.
        if (!pathname.startsWith(BLOB_PREFIX)) {
          throw new Error(`Uploads must live under "${BLOB_PREFIX}"`);
        }
        return {
          allowedContentTypes: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-msvideo'],
          maximumSizeInBytes: MAX_VIDEO_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        // No pipeline kickoff here — see file-header comment.
        logger.info('blob upload completed', { pathname: blob.pathname });
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('blob-upload handler failed', { userId, error: message });
    return NextResponse.json({ error: 'Failed to prepare upload', detail: message }, { status: 500 });
  }
}
