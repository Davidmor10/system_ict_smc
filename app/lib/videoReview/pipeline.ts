// Trade Review pipeline — the orchestrator.
//
// Flow: upload video to Gemini File API → poll until state ACTIVE →
// run vision + transcript in parallel → build the report → persist →
// (async, non-blocking) update pattern memory.
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
import type { TraderContext } from './types';

/** Upload a video blob to Gemini File API and return the file URI once ACTIVE.
    Used only for small server-side uploads (tests, dev). Large videos come from
    the browser via the resumable-upload flow, which never touches this. */
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

/** Poll a file until it's ACTIVE. Gemini video processing usually completes in
    5–30s. Cap the wait so a stuck file doesn't hang the pipeline forever. */
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

/** Run the full analysis on an already-uploaded video. The review row must
    exist (with status 'analyzing') before this is called. */
export async function runReviewPipeline(reviewId: string, clerkId: string): Promise<void> {
  try {
    const row = await getReview(reviewId, clerkId);
    if (!row) throw new Error('review not found');
    if (!row.videoFileUri || !row.videoMime) throw new Error('review has no video URI');

    // The client uploads directly to Gemini's resumable endpoint, so by the
    // time we get here processing may still be in progress on Gemini's side.
    // Wait for ACTIVE before firing vision/transcript against it.
    const name = fileNameFromUri(row.videoFileUri);
    if (name) {
      const active = await waitForActive(name);
      if (active.uri && active.uri !== row.videoFileUri) {
        await updateReview(reviewId, { videoFileUri: active.uri });
        row.videoFileUri = active.uri;
      }
    }

    const ctx = await buildTraderContext(clerkId, row.tradeId);
    if (!ctx) throw new Error('could not build trader context (Supabase not configured or trade missing)');

    // Vision and transcript are independent — parallelize.
    const [vision, transcript] = await Promise.all([
      analyzeVideoChart(row.videoFileUri, row.videoMime),
      transcribeVideo(row.videoFileUri, row.videoMime),
    ]);
    await updateReview(reviewId, { vision, transcript });

    const report = await generateReport(vision, transcript, ctx);
    await updateReview(reviewId, { report, status: 'done' });

    // Pattern memory update is best-effort — never fail the pipeline over it.
    updateFromReport(clerkId, row.tradeId, report).catch(err => {
      logger.warn('pattern memory update failed after review', { reviewId, error: err instanceof Error ? err.message : String(err) });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('trade review pipeline failed', { reviewId, error: message });
    await updateReview(reviewId, { status: 'failed', errorMessage: message });
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

/** Testable version — inject fakes for each stage instead of the real ones. */
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
