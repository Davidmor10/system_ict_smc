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

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limited = checkRateLimit(`trade-review:blob-upload:${userId}`, 20, 60_000);
  if (!limited.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

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
