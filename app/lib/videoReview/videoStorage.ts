// Supabase Storage bridge for the Trade Review upload flow.
//
// Why this exists: the browser can't upload directly to the Gemini File API
// (no CORS on Google's endpoint) and it can't upload through our Next.js
// route either (Vercel serverless caps request bodies at 4.5MB). So the
// browser uploads to Supabase Storage via a signed URL, then the server
// transfers the file to Gemini out-of-band. This module owns everything on
// the Supabase Storage side: bucket bootstrap, signed URL creation, transfer,
// cleanup.
//
// All paths are namespaced by clerkId so a signed URL for user A can never
// write into user B's namespace even if the client tried to.

import { createServerSupabaseClient, isSupabaseConfigured } from '../supabase/server';
import { genAI } from '../ai/client';
import { logger } from '../logger';

/** Bucket must be created once per Supabase project. We create-on-first-use
    with the service role key so nobody has to click through the dashboard. */
export const VIDEO_BUCKET = 'trade-review-videos';

/** Max file size Supabase Storage will accept for this bucket. Same cap the
    UI advertises so a rejection at the storage layer never surprises the user. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

let bucketReady = false;

/** Idempotent — no-op if the bucket already exists. Runs once per cold start. */
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const supabase = createServerSupabaseClient();
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw new Error(`list buckets failed: ${listErr.message}`);
  if (buckets?.some(b => b.name === VIDEO_BUCKET)) { bucketReady = true; return; }
  const { error: createErr } = await supabase.storage.createBucket(VIDEO_BUCKET, {
    public: false,
    fileSizeLimit: MAX_VIDEO_BYTES,
    allowedMimeTypes: ['video/*'],
  });
  // A concurrent request might have just created it — treat that as success.
  if (createErr && !/already exists/i.test(createErr.message)) {
    throw new Error(`create bucket failed: ${createErr.message}`);
  }
  bucketReady = true;
}

/** Sanitize an incoming mime like "video/quicktime" into a filesystem-safe
    extension. Unknown types default to `bin` — Gemini reads the mimeType
    header, not the extension, so this is only for storage-side hygiene. */
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'video/x-matroska': 'mkv', 'video/x-msvideo': 'avi',
  };
  return map[mime] ?? 'bin';
}

/** Build a storage path that a specific user is allowed to write to. */
export function buildStoragePath(clerkId: string, mimeType: string): string {
  const stamp = Date.now();
  const rnd = crypto.randomUUID().slice(0, 8);
  return `${clerkId}/${stamp}-${rnd}.${extFromMime(mimeType)}`;
}

/** Guard: incoming storagePath from the client must live under the caller's
    own prefix. Otherwise a malicious client could hand us another user's
    path and get their video processed. */
export function ownsStoragePath(clerkId: string, path: string): boolean {
  return typeof path === 'string' && path.startsWith(`${clerkId}/`) && !path.includes('..');
}

/** Ask Supabase for a signed upload URL. The browser can PUT the video bytes
    directly to this URL — no auth headers, no CORS blockers. */
export async function createUploadUrl(clerkId: string, mimeType: string): Promise<{ uploadUrl: string; storagePath: string; token: string }> {
  if (!isSupabaseConfigured()) throw new Error('Supabase not configured');
  await ensureBucket();
  const path = buildStoragePath(clerkId, mimeType);
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`signed upload url failed: ${error?.message ?? 'no data'}`);
  return { uploadUrl: data.signedUrl, storagePath: data.path, token: data.token };
}

/** Server-to-server: pull the video from Supabase Storage and hand it to the
    Gemini File API. Returns the Gemini file URI + mimeType. Server-to-server
    means no browser body-size cap and no CORS. */
export async function transferToGemini(storagePath: string, mimeType: string): Promise<{ fileUri: string }> {
  if (!isSupabaseConfigured()) throw new Error('Supabase not configured');
  const supabase = createServerSupabaseClient();
  const { data: blob, error } = await supabase.storage.from(VIDEO_BUCKET).download(storagePath);
  if (error || !blob) throw new Error(`storage download failed: ${error?.message ?? 'no blob'}`);

  const uploaded = await genAI.files.upload({ file: blob, config: { mimeType } });
  if (!uploaded.uri) throw new Error('Gemini upload returned no URI');
  return { fileUri: uploaded.uri };
}

/** Delete a video from Supabase Storage. Best-effort — a failed delete just
    leaves an orphan file we can sweep later, it doesn't invalidate the
    review. */
export async function deleteFromStorage(storagePath: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.storage.from(VIDEO_BUCKET).remove([storagePath]);
    if (error) logger.warn('storage delete failed', { storagePath, error: error.message });
  } catch (err) {
    logger.warn('storage delete threw', { storagePath, error: err instanceof Error ? err.message : String(err) });
  }
}
