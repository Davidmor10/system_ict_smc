// Trade Review pipeline — the orchestrator.
//
// Flow: transfer video from Supabase Storage → Gemini File API → wait ACTIVE
// → run vision + transcript in parallel → build the report → persist →
// (async, non-blocking) update pattern memory → delete from Supabase Storage.
//
// Runs entirely server-side (never touches the DOM). Every stage updates the
// review row's status so the client can poll and paint progress. A failure at
// any stage marks the row 'failed' with a human-readable message rather than
// letting the promise reject silently.

import { genAI } from '../ai/client';
import { logger } from '../logger';
import { FileState } from '@google/genai';
import { analyzeVideoChart } from './visionAnalyzer';
import { transcribeVideo } from './transcriber';
import { generateReport } from './reportGenerator';
import { updateFromReport } from './patternMemory';
import { buildTraderContext } from './contextBuilder';
import { updateReview, getReview } from './reviewStore';
import { transferToGemini, deleteFromStorage } from './videoStorage';
import type { TraderContext } from './types';

/** Upload a video blob directly to Gemini File API. Only used by unit tests
    and small server-side uploads — production uploads flow through Supabase
    Storage first. */
export async function uploadVideoToGemini(blob: Blob, mimeType: string): Promise<{ fileUri: string; mimeType: string }> {
  const uploaded = await genAI.files.upload({ file: blob, config: { mimeType } });
  if (!uploaded.name) throw new Error('Gemini upload did not return a file name');
  const active = await waitForActive(uploaded.name);
  if (!active.uri) throw new Error('Gemini file has no URI after processing');
  return { fileUri: active.uri, mimeType: active.mimeType ?? mimeType };
}

/** Extract the Gemini resource name ("files/xxx") from an upload URI. */
function fileNameFromUri(uri: string): string | null {
  const m = /(files\/[^/?#]+)/.exec(uri);
  return m ? m[1] : null;
}

/** Poll a file until it's ACTIVE. Gemini video processing usually completes
    within seconds but can take longer for long clips. Cap the wait so a stuck
    file doesn't hang the pipeline forever. */
export async function waitForActive(name: string, timeoutMs = 180_000, intervalMs = 3_000): Promise<{ uri?: string; mimeType?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const file = await genAI.files.get({ name });
    if (file.state === FileState.ACTIVE) return { uri: file.uri, mimeType: file.mimeType };
    if (file.state === FileState.FAILED) throw new Error(`Gemini file processing failed: ${file.error?.message ?? 'unknown'}`);
    await sleep(intervalMs);
  }
  throw new Error(`Gemini file did not become ACTIVE within ${timeoutMs}ms`);
}

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

/** Run the full analysis for a review row. The row must already exist and
    carry either a storagePath (client uploaded to Supabase) or a videoFileUri
    (dev/test path where the file was uploaded server-side already). */
export async function runReviewPipeline(reviewId: string, clerkId: string): Promise<void> {
  let storagePathToClean: string | null = null;
  try {
    const row = await getReview(reviewId, clerkId);
    if (!row) throw new Error('review not found');
    if (!row.videoMime) throw new Error('review has no mime type');

    // Step 1 — get a Gemini fileUri. Either it was set upfront (test path) or
    // we pull the video from Supabase Storage and hand it to Gemini here.
    let fileUri = row.videoFileUri ?? null;
    if (!fileUri) {
      if (!row.storagePath) throw new Error('review has neither a videoFileUri nor a storagePath');
      const transferred = await transferToGemini(row.storagePath, row.videoMime);
      fileUri = transferred.fileUri;
      storagePathToClean = row.storagePath;
      await updateReview(reviewId, { videoFileUri: fileUri });
    }

    // Step 2 — wait until Gemini has finished ingesting the file. Vision and
    // transcript both need state=ACTIVE or the model can't read it.
    const name = fileNameFromUri(fileUri);
    if (name) {
      const active = await waitForActive(name);
      if (active.uri && active.uri !== fileUri) {
        fileUri = active.uri;
        await updateReview(reviewId, { videoFileUri: fileUri });
      }
    }

    // Step 3 — gather everything about the trader (rules, setups, stats,
    // pattern memory) so the report generator can cross-reference.
    const ctx = await buildTraderContext(clerkId, row.tradeId);
    if (!ctx) throw new Error('could not build trader context (Supabase not configured or trade missing)');

    // Step 4 — vision + transcript are independent; run in parallel.
    const [vision, transcript] = await Promise.all([
      analyzeVideoChart(fileUri, row.videoMime),
      transcribeVideo(fileUri, row.videoMime),
    ]);
    await updateReview(reviewId, { vision, transcript });

    // Step 5 — synthesize the 9-section report.
    const report = await generateReport(vision, transcript, ctx);
    await updateReview(reviewId, { report, status: 'done' });

    // Step 6 — pattern memory update is best-effort; never fail the pipeline
    // over it. And clean up the Supabase copy — the report is persisted, the
    // Gemini file self-expires after 48h, we don't need a third copy sitting
    // around costing storage.
    updateFromReport(clerkId, row.tradeId, report).catch(err => {
      logger.warn('pattern memory update failed after review', { reviewId, error: err instanceof Error ? err.message : String(err) });
    });
    if (storagePathToClean) {
      void deleteFromStorage(storagePathToClean);
      await updateReview(reviewId, { storagePath: null });
      storagePathToClean = null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('trade review pipeline failed', { reviewId, error: message });
    await updateReview(reviewId, { status: 'failed', errorMessage: message });
    // On failure, leave the Supabase copy in place so a retry doesn't require
    // a re-upload. A separate sweeper (or the user's next upload) can clean it.
  }
}

/** Exposed for tests — the shape of the intermediate call graph. */
export interface PipelineStages {
  buildContext: typeof buildTraderContext;
  vision: typeof analyzeVideoChart;
  transcript: typeof transcribeVideo;
  report: typeof generateReport;
  memory: typeof updateFromReport;
}

/** Testable version — inject fakes for each stage instead of the real ones.
    Skips the Supabase→Gemini transfer step and expects the row to already
    have a videoFileUri; the transfer path is exercised in an integration
    test against a real Supabase instance. */
export async function runReviewPipelineWith(
  reviewId: string,
  clerkId: string,
  stages: PipelineStages,
  store: { get: typeof getReview; update: typeof updateReview },
): Promise<void> {
  try {
    const row = await store.get(reviewId, clerkId);
    if (!row) throw new Error('review not found');
    if (!row.videoFileUri || !row.videoMime) throw new Error('review has no video URI');

    const ctx = await stages.buildContext(clerkId, row.tradeId);
    if (!ctx) throw new Error('no context');

    const [vision, transcript] = await Promise.all([
      stages.vision(row.videoFileUri, row.videoMime),
      stages.transcript(row.videoFileUri, row.videoMime),
    ]);
    await store.update(reviewId, { vision, transcript });

    const report = await stages.report(vision, transcript, ctx as TraderContext);
    await store.update(reviewId, { report, status: 'done' });

    stages.memory(clerkId, row.tradeId, report).catch(() => { /* non-blocking */ });
  } catch (err) {
    await store.update(reviewId, {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}
