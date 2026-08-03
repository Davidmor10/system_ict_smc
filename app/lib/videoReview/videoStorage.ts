// Vercel Blob bridge for the Trade Review upload flow.
//
// Why Vercel Blob and not Supabase Storage: Supabase Free tier caps files at
// 50MB, which rules out any real trade-review video. Vercel Blob is
// purpose-built for large direct-from-browser uploads (up to 5GB per file,
// 500MB free tier, one-click setup in the same Vercel dashboard the app
// already runs on).
//
// The flow:
//   1) Browser calls upload() from @vercel/blob/client → hits our
//      /api/trade-review/blob-upload route to get a scoped client token.
//   2) Browser PUTs the video directly to Vercel Blob (no CORS, no size cap).
//   3) Browser posts { tradeId, blobUrl } to /api/trade-review → we create
//      the review row and kick off the pipeline.
//   4) Pipeline downloads the video from the blob URL (server-to-server,
//      no cross-origin constraints) → uploads to Gemini File API → analyzes
//      → deletes the blob.

import { del } from '@vercel/blob';
import { genAI } from '../ai/client';
import { logger } from '../logger';

/** Path prefix under which every trade-review upload lives inside the store.
    Keeps the Blob store tidy if it also hosts other kinds of assets. */
export const BLOB_PREFIX = 'trade-reviews/';

/** Practical cap on the client upload token — same value the UI advertises. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

/** Guard: incoming blobUrl from the client must be a Vercel Blob URL under
    our store. Otherwise a client could hand us any URL on the internet and
    make our server pull from it. */
export function isOwnBlobUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    // Vercel Blob public URLs live on *.public.blob.vercel-storage.com and
    // *.blob.vercel-storage.com. Any other host is not our storage.
    return u.protocol === 'https:' && /\.blob\.vercel-storage\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

/** Server-to-server: pull the video from Vercel Blob and hand it to the
    Gemini File API. Returns the Gemini file URI. Server-to-server means no
    browser body-size cap and no CORS. */
export async function transferToGemini(blobUrl: string, mimeType: string): Promise<{ fileUri: string }> {
  const res = await fetch(blobUrl);
  if (!res.ok) throw new Error(`blob fetch failed: ${res.status}`);
  const blob = await res.blob();
  const uploaded = await genAI.files.upload({ file: blob, config: { mimeType } });
  if (!uploaded.uri) throw new Error('Gemini upload returned no URI');
  return { fileUri: uploaded.uri };
}

/** Delete a video from Vercel Blob. Best-effort — a failed delete just
    leaves an orphan file we can sweep later, it doesn't invalidate the
    review. */
export async function deleteBlob(blobUrl: string): Promise<void> {
  try {
    await del(blobUrl);
  } catch (err) {
    logger.warn('blob delete failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
