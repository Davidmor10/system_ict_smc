// ─────────────────────────────────────────────────────────────────────────────
// All Supabase reads/writes for the Trader Intelligence System. Every query
// is scoped by clerk_id (the service-role client bypasses RLS by design — see
// supabase-migration.sql's comment block — so this scoping IS the real access
// control). Row <-> domain-type mapping lives here so the pure modules in
// profile.ts/patternMemory.ts/hypothesis.ts/scores.ts/memory.ts never know
// about snake_case columns or jsonb parsing.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import { rowToTrade, type TradeRow } from '../../api/journal/route';
import type { TradeEntry } from '../journal';
import type {
  HypothesisSnapshot, HypothesisState, KnownFact, PatternMemoryRow, ScoreSnapshot, TraderProfile,
} from './types';

// ── Trades ───────────────────────────────────────────────────────────────────

/** All of a user's non-deleted trades. GET /api/journal deliberately leaves
    deleted_at filtering to the client, so any server-side pipeline reading
    trades directly must filter it here itself — otherwise soft-deleted
    trades would silently pollute the profile/pattern memory. */
export async function getRecentTrades(supabase: SupabaseClient, clerkId: string): Promise<TradeEntry[]> {
  const { data, error } = await supabase
    .from('journal_trades')
    .select('*')
    .eq('clerk_id', clerkId)
    .is('deleted_at', null)
    .order('id', { ascending: false });
  if (error || !data) return [];
  return (data as TradeRow[]).map(rowToTrade);
}

// ── Trader Profiles ──────────────────────────────────────────────────────────

export interface TraderProfileRecord {
  profile: TraderProfile;
  previousProfile: TraderProfile | null;
  edgeScore: number | null;
  learningScore: number | null;
  scoreHistory: ScoreSnapshot[];
  knownFacts: KnownFact[];
  builtFromTradeCount: number;
  lastTradeDateIso: string | null;
}

export async function getTraderProfile(supabase: SupabaseClient, clerkId: string): Promise<TraderProfileRecord | null> {
  const { data } = await supabase.from('trader_profiles').select('*').eq('clerk_id', clerkId).maybeSingle();
  if (!data) return null;
  return {
    profile: data.profile as TraderProfile,
    previousProfile: (data.previous_profile as TraderProfile | null) ?? null,
    edgeScore: data.edge_score as number | null,
    learningScore: data.learning_score as number | null,
    scoreHistory: (data.score_history as ScoreSnapshot[] | null) ?? [],
    knownFacts: (data.ai_known_facts as KnownFact[] | null) ?? [],
    builtFromTradeCount: (data.built_from_trade_count as number | null) ?? 0,
    lastTradeDateIso: (data.last_trade_date_iso as string | null) ?? null,
  };
}

export async function saveTraderProfile(supabase: SupabaseClient, clerkId: string, record: TraderProfileRecord): Promise<void> {
  await supabase.from('trader_profiles').upsert({
    clerk_id: clerkId,
    schema_version: record.profile.schemaVersion,
    built_from_trade_count: record.builtFromTradeCount,
    last_trade_date_iso: record.lastTradeDateIso,
    profile: record.profile,
    previous_profile: record.previousProfile,
    edge_score: record.edgeScore,
    learning_score: record.learningScore,
    score_history: record.scoreHistory,
    ai_known_facts: record.knownFacts,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'clerk_id' });
}

// ── Pattern Memory ───────────────────────────────────────────────────────────

export async function getPatternMemory(supabase: SupabaseClient, clerkId: string): Promise<PatternMemoryRow[]> {
  const { data } = await supabase.from('pattern_memory').select('*').eq('clerk_id', clerkId);
  if (!data) return [];
  return data.map((r): PatternMemoryRow => ({
    clerkId: r.clerk_id, patternId: r.pattern_id, kind: r.kind, subject: r.subject,
    status: r.status, currentMetric: r.current_metric, currentConfidenceLevel: r.current_confidence_level,
    currentSampleSize: r.current_sample_size, baselineWinRate: r.baseline_win_rate, delta: r.delta,
    firstDetectedAt: r.first_detected_at, lastSeenAt: r.last_seen_at, lastUpdatedAt: r.last_updated_at,
    consecutiveMisses: r.consecutive_misses, history: r.history ?? [],
    aiTitle: r.ai_title, aiEvidence: r.ai_evidence, aiAction: r.ai_action,
    aiPhrasedStatus: r.ai_phrased_status, aiPhrasedWinRate: r.ai_phrased_win_rate,
    createdAt: r.created_at,
  }));
}

export async function savePatternMemory(supabase: SupabaseClient, rows: PatternMemoryRow[]): Promise<void> {
  if (rows.length === 0) return;
  await supabase.from('pattern_memory').upsert(rows.map(r => ({
    clerk_id: r.clerkId, pattern_id: r.patternId, kind: r.kind, subject: r.subject,
    status: r.status, current_metric: r.currentMetric, current_confidence_level: r.currentConfidenceLevel,
    current_sample_size: r.currentSampleSize, baseline_win_rate: r.baselineWinRate, delta: r.delta,
    first_detected_at: r.firstDetectedAt, last_seen_at: r.lastSeenAt, last_updated_at: r.lastUpdatedAt,
    consecutive_misses: r.consecutiveMisses, history: r.history,
    ai_title: r.aiTitle, ai_evidence: r.aiEvidence, ai_action: r.aiAction,
    ai_phrased_status: r.aiPhrasedStatus, ai_phrased_win_rate: r.aiPhrasedWinRate,
    created_at: r.createdAt,
  })), { onConflict: 'clerk_id,pattern_id' });
}

// ── Trader Hypotheses ────────────────────────────────────────────────────────

export async function getHypothesis(supabase: SupabaseClient, clerkId: string): Promise<HypothesisState | null> {
  const { data } = await supabase.from('trader_hypotheses').select('*').eq('clerk_id', clerkId).maybeSingle();
  if (!data) return null;
  return {
    clerkId: data.clerk_id, description: data.description, evidence: data.evidence,
    supportingPatternIds: data.supporting_pattern_ids ?? [], supportingMetrics: data.supporting_metrics ?? {},
    confidenceScore: data.confidence_score, status: data.status,
    firstDetectedAt: data.first_detected_at, lastUpdatedAt: data.last_updated_at,
    aiPhrasedStatus: data.ai_phrased_status, aiPhrasedConfidence: data.ai_phrased_confidence,
    createdAt: data.created_at,
  };
}

export async function saveHypothesis(supabase: SupabaseClient, state: HypothesisState): Promise<void> {
  await supabase.from('trader_hypotheses').upsert({
    clerk_id: state.clerkId, description: state.description, evidence: state.evidence,
    supporting_pattern_ids: state.supportingPatternIds, supporting_metrics: state.supportingMetrics,
    confidence_score: state.confidenceScore, status: state.status,
    first_detected_at: state.firstDetectedAt, last_updated_at: state.lastUpdatedAt,
    ai_phrased_status: state.aiPhrasedStatus, ai_phrased_confidence: state.aiPhrasedConfidence,
    created_at: state.createdAt,
  }, { onConflict: 'clerk_id' });
}

// ── Weekly AI Reports ────────────────────────────────────────────────────────

export interface WeeklyReportRecord {
  clerkId: string;
  isoWeek: string;
  weekStartDate: string;
  tradeCount: number;
  confidenceLevel: string;
  narrative: { schemaVersion: number; paragraphs: string[] };
  facts: Record<string, unknown>;
  modelUsed: string | null;
  primaryHypothesisSnapshot: HypothesisSnapshot | null;
}

export async function getWeeklyReport(supabase: SupabaseClient, clerkId: string, isoWeek: string): Promise<WeeklyReportRecord | null> {
  const { data } = await supabase.from('weekly_ai_reports').select('*').eq('clerk_id', clerkId).eq('iso_week', isoWeek).maybeSingle();
  if (!data) return null;
  return {
    clerkId: data.clerk_id, isoWeek: data.iso_week, weekStartDate: data.week_start_date,
    tradeCount: data.trade_count, confidenceLevel: data.confidence_level,
    narrative: data.narrative, facts: data.facts, modelUsed: data.model_used,
    primaryHypothesisSnapshot: data.primary_hypothesis_snapshot ?? null,
  };
}

export async function saveWeeklyReport(supabase: SupabaseClient, record: WeeklyReportRecord): Promise<void> {
  await supabase.from('weekly_ai_reports').upsert({
    clerk_id: record.clerkId, iso_week: record.isoWeek, week_start_date: record.weekStartDate,
    generated_at: new Date().toISOString(), trade_count: record.tradeCount, confidence_level: record.confidenceLevel,
    narrative: record.narrative, facts: record.facts, model_used: record.modelUsed,
    primary_hypothesis_snapshot: record.primaryHypothesisSnapshot,
  }, { onConflict: 'clerk_id,iso_week' });
}

export async function getRecentWeeklyReports(supabase: SupabaseClient, clerkId: string, limit = 12): Promise<WeeklyReportRecord[]> {
  const { data } = await supabase
    .from('weekly_ai_reports')
    .select('*')
    .eq('clerk_id', clerkId)
    .order('week_start_date', { ascending: false })
    .limit(limit);
  if (!data) return [];
  return data.map(record => ({
    clerkId: record.clerk_id, isoWeek: record.iso_week, weekStartDate: record.week_start_date,
    tradeCount: record.trade_count, confidenceLevel: record.confidence_level,
    narrative: record.narrative, facts: record.facts, modelUsed: record.model_used,
    primaryHypothesisSnapshot: record.primary_hypothesis_snapshot ?? null,
  }));
}

// ── AI Insight History (best-effort audit trail) ────────────────────────────

export async function appendInsightHistory(
  supabase: SupabaseClient,
  clerkId: string,
  kind: 'profile_update' | 'pattern_status_change' | 'hypothesis_status_change' | 'weekly_report' | 'dashboard_insight_shown',
  refId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('ai_insight_history').insert({ clerk_id: clerkId, kind, ref_id: refId, payload });
  } catch {
    // Best-effort audit trail — never let a logging failure break the pipeline.
  }
}
