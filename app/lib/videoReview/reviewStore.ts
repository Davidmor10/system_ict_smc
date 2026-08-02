// Persistence layer for trade reviews. Uses a dedicated Supabase table
// (trade_reviews) with clerk_id scoping — same access-control shape as the
// rest of the app. When Supabase isn't configured (local dev without keys)
// falls back to an in-memory Map so the pipeline still runs end-to-end.

import { logger } from '../logger';
import { createServerSupabaseClient, isSupabaseConfigured } from '../supabase/server';
import type { TradeReviewRow, TradeReviewReport, VisionAnalysis, Transcript } from './types';

const TABLE = 'trade_reviews';
const memory = new Map<string, TradeReviewRow>();

export async function createReview(
  clerkId: string,
  tradeId: number,
  init: { videoFileUri?: string | null; storagePath?: string | null; videoMime: string },
): Promise<TradeReviewRow> {
  const now = Date.now();
  const row: TradeReviewRow = {
    id: crypto.randomUUID(),
    clerkId,
    tradeId,
    status: 'analyzing',
    videoFileUri: init.videoFileUri ?? null,
    storagePath: init.storagePath ?? null,
    videoMime: init.videoMime,
    createdAt: now,
    updatedAt: now,
  };

  if (!isSupabaseConfigured()) { memory.set(row.id, row); return row; }
  try {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.from(TABLE).insert(rowToDb(row));
    if (error) throw error;
    return row;
  } catch (err) {
    logger.warn('createReview failed, falling back to memory', { error: err instanceof Error ? err.message : String(err) });
    memory.set(row.id, row);
    return row;
  }
}

export async function updateReview(id: string, patch: Partial<TradeReviewRow>): Promise<void> {
  const next = { ...patch, updatedAt: Date.now() };
  if (!isSupabaseConfigured()) {
    const cur = memory.get(id);
    if (cur) memory.set(id, { ...cur, ...next });
    return;
  }
  try {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.from(TABLE).update(patchToDb(next)).eq('id', id);
    if (error) throw error;
  } catch (err) {
    logger.warn('updateReview failed', { id, error: err instanceof Error ? err.message : String(err) });
    const cur = memory.get(id); if (cur) memory.set(id, { ...cur, ...next });
  }
}

export async function getReview(id: string, clerkId: string): Promise<TradeReviewRow | null> {
  if (!isSupabaseConfigured()) {
    const cur = memory.get(id);
    return cur && cur.clerkId === clerkId ? cur : null;
  }
  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).eq('clerk_id', clerkId).maybeSingle();
    if (error || !data) return null;
    return dbToRow(data);
  } catch (err) {
    logger.warn('getReview failed', { id, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function listReviewsForTrade(clerkId: string, tradeId: number): Promise<TradeReviewRow[]> {
  if (!isSupabaseConfigured()) {
    return [...memory.values()].filter(r => r.clerkId === clerkId && r.tradeId === tradeId).sort((a, b) => b.createdAt - a.createdAt);
  }
  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.from(TABLE).select('*').eq('clerk_id', clerkId).eq('trade_id', tradeId).order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map(dbToRow);
  } catch (err) {
    logger.warn('listReviewsForTrade failed', { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/* ── Row / DB shape translations ── */
interface DbRow {
  id: string; clerk_id: string; trade_id: number; status: string; error_message?: string | null;
  video_file_uri?: string | null; storage_path?: string | null;
  video_mime?: string | null; video_duration_sec?: number | null;
  report?: TradeReviewReport | null; vision?: VisionAnalysis | null; transcript?: Transcript | null;
  created_at: string; updated_at: string;
}
function rowToDb(r: TradeReviewRow): DbRow {
  return {
    id: r.id, clerk_id: r.clerkId, trade_id: r.tradeId, status: r.status,
    error_message: r.errorMessage ?? null,
    video_file_uri: r.videoFileUri ?? null, storage_path: r.storagePath ?? null,
    video_mime: r.videoMime ?? null, video_duration_sec: r.videoDurationSec ?? null,
    report: r.report ?? null, vision: r.vision ?? null, transcript: r.transcript ?? null,
    created_at: new Date(r.createdAt).toISOString(),
    updated_at: new Date(r.updatedAt).toISOString(),
  };
}
function patchToDb(p: Partial<TradeReviewRow> & { updatedAt: number }): Partial<DbRow> {
  const out: Partial<DbRow> = { updated_at: new Date(p.updatedAt).toISOString() };
  if (p.status !== undefined)           out.status = p.status;
  if (p.errorMessage !== undefined)     out.error_message = p.errorMessage;
  if (p.videoFileUri !== undefined)     out.video_file_uri = p.videoFileUri;
  if (p.storagePath !== undefined)      out.storage_path = p.storagePath;
  if (p.videoMime !== undefined)        out.video_mime = p.videoMime;
  if (p.videoDurationSec !== undefined) out.video_duration_sec = p.videoDurationSec;
  if (p.report !== undefined)           out.report = p.report;
  if (p.vision !== undefined)           out.vision = p.vision;
  if (p.transcript !== undefined)       out.transcript = p.transcript;
  return out;
}
function dbToRow(d: DbRow): TradeReviewRow {
  return {
    id: d.id, clerkId: d.clerk_id, tradeId: d.trade_id, status: d.status as TradeReviewRow['status'],
    errorMessage: d.error_message ?? undefined,
    videoFileUri: d.video_file_uri ?? undefined,
    storagePath: d.storage_path ?? undefined,
    videoMime: d.video_mime ?? undefined,
    videoDurationSec: d.video_duration_sec ?? undefined,
    report: d.report ?? undefined,
    vision: d.vision ?? undefined,
    transcript: d.transcript ?? undefined,
    createdAt: new Date(d.created_at).getTime(),
    updatedAt: new Date(d.updated_at).getTime(),
  };
}
