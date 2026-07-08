// ─────────────────────────────────────────────────────────────────────────────
// Trader Intelligence System — public orchestrator API. Every exported
// function here is the DB-touching half of the pure modules in this
// directory: fetch → derive (pure) → persist. Nothing below computes a
// statistic itself — that's always delegated to analytics/* or the pure
// intelligence/* modules. LLM calls only ever phrase numbers that are
// already computed, and only when a cached phrasing has gone stale.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addDaysISO, discoverPatterns, isoWeekKey, runFullAnalysis, startOfIsoWeek,
  type ConfidenceLevel, type FullAnalysis, type GroupPerformance,
} from '../analytics';
import { createServerSupabaseClient, isSupabaseConfigured } from '../supabase/server';
import { todayISO, type TradeEntry } from '../journal';
import { SESS } from '../sessions';
import { logger } from '../logger';
import { generateHypothesisPhrasing, generateInsightsPhrasing, generatePatternPhrasing } from '../ai/insightPhrasing';
import { generateNarrativeText, type NarrativeFacts } from '../ai/weeklyNarrative';
import {
  summarizeAnalysis, summarizeComparison, summarizeKnownFacts, summarizePatternMemory, summarizeRootCause,
} from '../ai/factsBlock';

import * as repo from './repository';
import { deriveTraderProfile } from './profile';
import { diffPatternMemory } from './patternMemory';
import { computePeriodComparison } from './periods';
import { selectPrimaryPattern } from './dashboardInsight';
import { deriveHypothesis } from './hypothesis';
import { computeEdgeScore, computeLearningScore } from './scores';
import { deriveKnownFacts } from './memory';
import { diagnoseRootCause } from './rootCause';
import { buildEvolutionTimeline, type WeeklyHypothesisRecord } from './evolutionTimeline';
import type {
  EvolutionEntry, HypothesisState, KnownFact, PatternMemoryRow, PatternMemorySubjectSummary,
  PeriodComparison, ScoreSnapshot, TraderProfile,
} from './types';

/** Dashboard "today's discovery" shape — mirrors the local interface already
    duplicated in app/components/DashboardView.tsx (kept as a client-side
    local type there so that file never pulls in server-only AI SDK modules).
    Keeping both in sync by shape, not by import, means DashboardView.tsx
    needs zero changes when this pipeline changes underneath it. */
export interface AiDiscovery {
  title: string;
  evidence: string;
  action: string;
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
}

const MAX_RECURRING_PATTERNS = 5;
const MIN_TRADES_FOR_WEEKLY = 3;       // matches the old weeklyReport.ts's threshold
const MIN_BASELINE_TRADES = 10;        // aligned to confidenceLevelFor's low/medium boundary
const MIN_PRIOR_REPORTS_FOR_FULL_CONFIDENCE = 2;
/** Below this, the dashboard falls back to the single strongest tracked
    pattern instead of the synthesized hypothesis — a low-confidence
    hypothesis isn't yet a better story than the plain top pattern. */
const HYPOTHESIS_DASHBOARD_MIN_CONFIDENCE = 50;
const DEFAULT_LANG: 'he' | 'en' = 'he';

function getClient(): SupabaseClient {
  return createServerSupabaseClient();
}

function downgradeConfidence(level: ConfidenceLevel): ConfidenceLevel {
  return level === 'high' ? 'medium' : 'low';
}

// ── The one atomic refresh — profile, pattern memory, and hypothesis all
// depend on each other in the same pass, so every public entry point below
// funnels through this instead of recomputing pieces independently. ──

interface RefreshResult {
  trades: TradeEntry[];
  analysis: FullAnalysis;
  profile: TraderProfile;
  previousProfile: TraderProfile | null;
  patternRows: PatternMemoryRow[];
  hypothesis: HypothesisState;
  edgeScore: number;
  learningScore: number;
  knownFacts: KnownFact[];
}

async function refreshIntelligence(supabase: SupabaseClient, userId: string, lang: 'he' | 'en'): Promise<RefreshResult> {
  const nowISO = new Date().toISOString();
  const trades = await repo.getRecentTrades(supabase, userId);
  const analysis = runFullAnalysis(trades);

  const [existingProfileRecord, existingPatternRows, existingHypothesis] = await Promise.all([
    repo.getTraderProfile(supabase, userId),
    repo.getPatternMemory(supabase, userId),
    repo.getHypothesis(supabase, userId),
  ]);

  const candidates = discoverPatterns(trades);
  const diff = diffPatternMemory(userId, candidates, existingPatternRows, nowISO);
  await repo.savePatternMemory(supabase, diff.toUpsert);
  await Promise.all(diff.statusChanges.map(change =>
    repo.appendInsightHistory(supabase, userId, 'pattern_status_change', change.patternId, { ...change }),
  ));

  const recurringConditions: PatternMemorySubjectSummary[] = diff.toUpsert
    .filter(p => p.status === 'active' || p.status === 'strengthening')
    .sort((a, b) => b.currentSampleSize - a.currentSampleSize)
    .slice(0, MAX_RECURRING_PATTERNS)
    .map(p => ({ patternId: p.patternId, subject: p.subject, status: p.status, metric: p.currentMetric }));

  const profile = deriveTraderProfile(analysis, trades, existingProfileRecord?.profile ?? null, recurringConditions);

  let hypothesis = deriveHypothesis(userId, diff.toUpsert, existingHypothesis, nowISO);
  if (hypothesis.status !== (existingHypothesis?.status ?? null)) {
    await repo.appendInsightHistory(supabase, userId, 'hypothesis_status_change', null, {
      previousStatus: existingHypothesis?.status ?? null, newStatus: hypothesis.status,
    });
  }
  // Only re-phrase when the identity actually changed (description cleared by
  // deriveHypothesis) — a continuing hypothesis keeps its cached text, same
  // discipline as pattern_memory's ai_title caching below.
  if (hypothesis.description === null && hypothesis.status !== 'insufficient_data' && hypothesis.status !== 'invalidated') {
    const phrasing = await generateHypothesisPhrasing(
      { status: hypothesis.status, confidenceScore: hypothesis.confidenceScore, supportingMetrics: hypothesis.supportingMetrics },
      lang,
    );
    if (phrasing) {
      hypothesis = { ...hypothesis, description: phrasing.description, evidence: phrasing.evidence };
    }
  }
  await repo.saveHypothesis(supabase, hypothesis);

  const edgeScore = computeEdgeScore(profile, diff.toUpsert, existingProfileRecord?.edgeScore ?? null);
  const learningScore = computeLearningScore(existingProfileRecord?.scoreHistory ?? [], edgeScore);
  const scoreSnapshot: ScoreSnapshot = {
    at: nowISO, edgeScore, learningScore,
    winRate: profile.winRate.current, avgRR: profile.avgRR.current, profitFactor: profile.profitFactor.current,
  };
  const scoreHistory = [...(existingProfileRecord?.scoreHistory ?? []), scoreSnapshot].slice(-12);

  const knownFacts = deriveKnownFacts(profile, existingProfileRecord?.knownFacts ?? [], nowISO);

  const closedCount = trades.filter(t => t.result !== 'OPEN').length;
  await repo.saveTraderProfile(supabase, userId, {
    profile, previousProfile: existingProfileRecord?.profile ?? null,
    edgeScore, learningScore, scoreHistory, knownFacts,
    builtFromTradeCount: closedCount, lastTradeDateIso: trades[0]?.dateISO ?? null,
  });
  await repo.appendInsightHistory(supabase, userId, 'profile_update', null, { closedCount, edgeScore, learningScore });

  return {
    trades, analysis, profile, previousProfile: existingProfileRecord?.profile ?? null,
    patternRows: diff.toUpsert, hypothesis, edgeScore, learningScore, knownFacts,
  };
}

// ── buildTraderProfile / updateTraderProfile ────────────────────────────────
// The profile is always a full recompute, never incrementally patched, so
// these are documented aliases of the same operation, not two code paths.

export async function buildTraderProfile(userId: string, lang: 'he' | 'en' = DEFAULT_LANG): Promise<TraderProfile | null> {
  if (!isSupabaseConfigured()) return null;
  const result = await refreshIntelligence(getClient(), userId, lang);
  return result.profile;
}

export const updateTraderProfile = buildTraderProfile;

// ── detectPatterns / updatePatternMemory ────────────────────────────────────

export async function detectPatterns(userId: string) {
  if (!isSupabaseConfigured()) return [];
  const trades = await repo.getRecentTrades(getClient(), userId);
  return discoverPatterns(trades);
}

/** Runs the same atomic refresh as buildTraderProfile — pattern memory can't
    be updated in isolation since the profile's recurringConditions and the
    hypothesis both depend on this run's pattern diff. */
export async function updatePatternMemory(userId: string, lang: 'he' | 'en' = DEFAULT_LANG): Promise<PatternMemoryRow[]> {
  if (!isSupabaseConfigured()) return [];
  const result = await refreshIntelligence(getClient(), userId, lang);
  return result.patternRows;
}

// ── comparePeriods ───────────────────────────────────────────────────────────

interface TradeWindows {
  thisWeekTrades: TradeEntry[];
  prevWeekTrades: TradeEntry[];
  baselineTrades: TradeEntry[];
}

/** thisWeek = Monday..today; prevWeek = the 7 days before that; baseline4wk =
    the 4 calendar weeks before prevWeek — deliberately disjoint from prevWeek
    so "vs last week" and "vs trailing baseline" never double-count a trade. */
function computeTradeWindows(trades: TradeEntry[], thisWeekStart: string): TradeWindows {
  const prevWeekStart = addDaysISO(thisWeekStart, -7);
  const prevWeekEnd = addDaysISO(thisWeekStart, -1);
  const baselineStart = addDaysISO(thisWeekStart, -35);
  const baselineEnd = addDaysISO(thisWeekStart, -8);

  return {
    thisWeekTrades: trades.filter(t => t.dateISO >= thisWeekStart),
    prevWeekTrades: trades.filter(t => t.dateISO >= prevWeekStart && t.dateISO <= prevWeekEnd),
    baselineTrades: trades.filter(t => t.dateISO >= baselineStart && t.dateISO <= baselineEnd),
  };
}

export async function comparePeriods(userId: string): Promise<PeriodComparison | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getClient();
  const trades = await repo.getRecentTrades(supabase, userId);
  const thisWeekStart = startOfIsoWeek(todayISO());
  const windows = computeTradeWindows(trades, thisWeekStart);

  const thisAnalysis = runFullAnalysis(windows.thisWeekTrades);
  const prevClosed = windows.prevWeekTrades.filter(t => t.result !== 'OPEN').length;
  const baselineClosed = windows.baselineTrades.filter(t => t.result !== 'OPEN').length;
  const prevAnalysis = prevClosed >= MIN_TRADES_FOR_WEEKLY ? runFullAnalysis(windows.prevWeekTrades) : null;
  const baselineAnalysis = baselineClosed >= MIN_BASELINE_TRADES ? runFullAnalysis(windows.baselineTrades) : null;

  return computePeriodComparison(thisAnalysis, prevAnalysis, baselineAnalysis);
}

// ── generateWeeklyDeepAnalysis ───────────────────────────────────────────────

export interface WeeklyDeepAnalysisResult {
  paragraphs: string[];
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
  weekKey: string;
}

export async function generateWeeklyDeepAnalysis(userId: string, lang: 'he' | 'en' = DEFAULT_LANG): Promise<WeeklyDeepAnalysisResult | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getClient();
  const today = todayISO();
  const weekKey = isoWeekKey(today);
  const thisWeekStart = startOfIsoWeek(today);

  const trades = await repo.getRecentTrades(supabase, userId);
  const windows = computeTradeWindows(trades, thisWeekStart);
  const closedThisWeek = windows.thisWeekTrades.filter(t => t.result !== 'OPEN');
  if (closedThisWeek.length < MIN_TRADES_FOR_WEEKLY) return null;

  // Avoid redundant LLM spend on repeat visits within the same week — only
  // regenerate if no report exists yet, or this week's closed-trade count
  // has moved since it was last generated.
  const cached = await repo.getWeeklyReport(supabase, userId, weekKey);
  if (cached && cached.tradeCount === closedThisWeek.length) {
    return {
      paragraphs: cached.narrative.paragraphs,
      confidenceLevel: cached.confidenceLevel as ConfidenceLevel,
      sampleSize: cached.tradeCount,
      weekKey,
    };
  }

  const previousProfileRecord = await repo.getTraderProfile(supabase, userId);
  const result = await refreshIntelligence(supabase, userId, lang);

  const thisAnalysis = runFullAnalysis(windows.thisWeekTrades);
  const prevClosed = windows.prevWeekTrades.filter(t => t.result !== 'OPEN').length;
  const baselineClosed = windows.baselineTrades.filter(t => t.result !== 'OPEN').length;
  const prevAnalysis = prevClosed >= MIN_TRADES_FOR_WEEKLY ? runFullAnalysis(windows.prevWeekTrades) : null;
  const baselineAnalysis = baselineClosed >= MIN_BASELINE_TRADES ? runFullAnalysis(windows.baselineTrades) : null;
  const comparison = computePeriodComparison(thisAnalysis, prevAnalysis, baselineAnalysis);

  const rootCause = diagnoseRootCause(comparison, result.profile, previousProfileRecord?.profile ?? null);

  const priorReports = await repo.getRecentWeeklyReports(supabase, userId, MIN_PRIOR_REPORTS_FOR_FULL_CONFIDENCE + 1);
  const isEarlyInHistory = priorReports.length < MIN_PRIOR_REPORTS_FOR_FULL_CONFIDENCE;
  const confidenceLevel = isEarlyInHistory
    ? downgradeConfidence(thisAnalysis.performance.confidence.level)
    : thisAnalysis.performance.confidence.level;

  const facts: NarrativeFacts = {
    thisWeekSummary: summarizeAnalysis(thisAnalysis),
    prevWeekSummary: prevAnalysis ? summarizeAnalysis(prevAnalysis) : null,
    baselineSummary: baselineAnalysis ? summarizeAnalysis(baselineAnalysis) : null,
    comparisonSummary: summarizeComparison(comparison),
    patternMemorySummary: summarizePatternMemory(result.patternRows.filter(p => p.status === 'active' || p.status === 'strengthening')),
    knownFactsSummary: summarizeKnownFacts(result.knownFacts),
    rootCauseSummary: summarizeRootCause(rootCause),
    hypothesisSummary: result.hypothesis.description
      ? `${result.hypothesis.description} (status: ${result.hypothesis.status}, confidence ${result.hypothesis.confidenceScore}/100)`
      : null,
    notesObservations: result.profile.notesObservations,
    isEarlyInHistory,
    confidenceLevel,
    sampleSize: closedThisWeek.length,
  };

  const narrative = await generateNarrativeText(facts, lang);
  if (!narrative) return null;

  await repo.saveWeeklyReport(supabase, {
    clerkId: userId, isoWeek: weekKey, weekStartDate: thisWeekStart,
    tradeCount: closedThisWeek.length, confidenceLevel,
    narrative: { schemaVersion: 1, paragraphs: narrative.paragraphs },
    facts: { ...comparison },
    modelUsed: null,
    primaryHypothesisSnapshot: result.hypothesis.description
      ? { description: result.hypothesis.description, status: result.hypothesis.status, confidenceScore: result.hypothesis.confidenceScore }
      : null,
  });
  await repo.appendInsightHistory(supabase, userId, 'weekly_report', weekKey, { sampleSize: closedThisWeek.length, confidenceLevel });

  return { paragraphs: narrative.paragraphs, confidenceLevel, sampleSize: closedThisWeek.length, weekKey };
}

// ── generateDashboardPrimaryInsight ──────────────────────────────────────────
// Selects (never freshly generates from scratch) the single best current
// insight — the hypothesis when it's confident enough, else the strongest
// tracked pattern. Output always maps onto the existing AiDiscovery shape so
// DashboardView.tsx needs zero changes.

function confidenceLevelForScore(score: number): ConfidenceLevel {
  if (score >= 80) return 'high';
  if (score >= HYPOTHESIS_DASHBOARD_MIN_CONFIDENCE) return 'medium';
  return 'low';
}

export async function generateDashboardPrimaryInsight(userId: string, lang: 'he' | 'en' = DEFAULT_LANG): Promise<AiDiscovery | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getClient();

  const profileRecord = await repo.getTraderProfile(supabase, userId);
  let patternRows: PatternMemoryRow[];
  let hypothesis: HypothesisState | null;

  if (!profileRecord) {
    // Cold-start bootstrap: populate everything once so the dashboard
    // doesn't stay empty until the user visits AI Analytics.
    const result = await refreshIntelligence(supabase, userId, lang);
    patternRows = result.patternRows;
    hypothesis = result.hypothesis;
  } else {
    [patternRows, hypothesis] = await Promise.all([
      repo.getPatternMemory(supabase, userId),
      repo.getHypothesis(supabase, userId),
    ]);
  }

  const hypothesisIsUsable = hypothesis
    && hypothesis.status !== 'insufficient_data'
    && hypothesis.status !== 'invalidated'
    && hypothesis.confidenceScore >= HYPOTHESIS_DASHBOARD_MIN_CONFIDENCE;

  if (hypothesisIsUsable && hypothesis) {
    let description = hypothesis.description;
    let evidence = hypothesis.evidence;
    if (!description) {
      const phrasing = await generateHypothesisPhrasing(
        { status: hypothesis.status, confidenceScore: hypothesis.confidenceScore, supportingMetrics: hypothesis.supportingMetrics },
        lang,
      );
      if (!phrasing) return null;
      description = phrasing.description;
      evidence = phrasing.evidence;
      await repo.saveHypothesis(supabase, { ...hypothesis, description, evidence });
    }
    await repo.appendInsightHistory(supabase, userId, 'dashboard_insight_shown', 'hypothesis', {
      confidenceScore: hypothesis.confidenceScore, status: hypothesis.status,
    });
    const sampleSize = Object.values(hypothesis.supportingMetrics)[0]?.confidence.sampleSize ?? 0;
    return {
      title: description,
      evidence: evidence ?? '',
      action: lang === 'he'
        ? 'המשך לעקוב אחרי התנאים האלה ובדוק אם הם ממשיכים לחזור.'
        : 'Keep watching these conditions and see if they keep repeating.',
      confidenceLevel: confidenceLevelForScore(hypothesis.confidenceScore),
      sampleSize,
    };
  }

  const anchor = selectPrimaryPattern(patternRows);
  if (!anchor) return null;

  const cacheIsFresh = anchor.aiTitle
    && anchor.aiPhrasedStatus === anchor.status
    && anchor.aiPhrasedWinRate !== null
    && Math.abs(anchor.currentMetric.winRate - anchor.aiPhrasedWinRate) <= 2;

  if (cacheIsFresh) {
    await repo.appendInsightHistory(supabase, userId, 'dashboard_insight_shown', anchor.patternId, { cached: true });
    return {
      title: anchor.aiTitle!, evidence: anchor.aiEvidence ?? '', action: anchor.aiAction ?? '',
      confidenceLevel: anchor.currentConfidenceLevel, sampleSize: anchor.currentSampleSize,
    };
  }

  const phrased = await generatePatternPhrasing(anchor, lang);
  if (!phrased) return null;

  await repo.savePatternMemory(supabase, [{
    ...anchor, aiTitle: phrased.title, aiEvidence: phrased.evidence, aiAction: phrased.action,
    aiPhrasedStatus: anchor.status, aiPhrasedWinRate: anchor.currentMetric.winRate,
  }]);
  await repo.appendInsightHistory(supabase, userId, 'dashboard_insight_shown', anchor.patternId, { cached: false });

  return {
    title: phrased.title, evidence: phrased.evidence, action: phrased.action,
    confidenceLevel: anchor.currentConfidenceLevel, sampleSize: anchor.currentSampleSize,
  };
}

// ── generatePersonalizedInsights ─────────────────────────────────────────────
// Replaces the old fixed opportunity/warning/pattern 3-slot structure. There
// is no rigid category schema here: it selects whatever the trader's own
// persisted data actually supports (the current hypothesis if confident
// enough, real recurring patterns, a genuine weakening pattern if one
// exists) and phrases only that — never manufactures a "warning" just to
// fill a slot that isn't backed by anything.

export interface PersonalizedInsight {
  subject: string;
  text: string;
  tone: 'positive' | 'caution' | 'neutral';
}

const MAX_PERSONALIZED_INSIGHTS = 4;
const MAX_STRONG_PATTERNS_IN_PANEL = 2;

function subjectLabelFor(subject: Record<string, string | number>, lang: 'he' | 'en'): string {
  const parts: string[] = [];
  if (subject.instrument) parts.push(String(subject.instrument));
  if (subject.confirmation) parts.push(String(subject.confirmation));
  if (subject.session) {
    const s = SESS.find(x => x.key === subject.session);
    parts.push(s ? (lang === 'he' ? s.he : s.en) : String(subject.session));
  }
  if (subject.direction) parts.push(subject.direction === 'LONG' ? (lang === 'he' ? 'לונג' : 'Long') : (lang === 'he' ? 'שורט' : 'Short'));
  if (subject.hour !== undefined) parts.push(`${String(subject.hour).padStart(2, '0')}:00`);
  return parts.join(' · ');
}

export interface PersonalizedInsightsDebug {
  supabaseConfigured: boolean;
  hadExistingProfile: boolean;
  patternRowCount: number;
  hypothesisStatus: string | null;
  builtFromTradeCount: number;
  candidateCount: number;
  /** null = never reached the phrasing step (candidateCount was 0). */
  phrasingSucceeded: boolean | null;
}

export interface PersonalizedInsightsResult {
  insights: PersonalizedInsight[];
  debug: PersonalizedInsightsDebug;
}

const EMPTY_DEBUG_NOT_CONFIGURED: PersonalizedInsightsDebug = {
  supabaseConfigured: false, hadExistingProfile: false, patternRowCount: 0,
  hypothesisStatus: null, builtFromTradeCount: 0, candidateCount: 0, phrasingSucceeded: null,
};

/** Temporary `debug` field on the response — this app has no live way to
    inspect a specific user's server-side state (no working local Supabase
    creds, no browser access to their session), so the diagnosis has to
    travel back through the API response itself instead of Vercel logs. */
export async function generatePersonalizedInsights(userId: string, lang: 'he' | 'en' = DEFAULT_LANG): Promise<PersonalizedInsightsResult> {
  if (!isSupabaseConfigured()) return { insights: [], debug: EMPTY_DEBUG_NOT_CONFIGURED };
  const supabase = getClient();

  const profileRecord = await repo.getTraderProfile(supabase, userId);
  const hadExistingProfile = !!profileRecord;
  let patternRows: PatternMemoryRow[];
  let hypothesis: HypothesisState | null;
  let profile: TraderProfile;
  let builtFromTradeCount: number;

  if (!profileRecord) {
    const result = await refreshIntelligence(supabase, userId, lang);
    patternRows = result.patternRows;
    hypothesis = result.hypothesis;
    profile = result.profile;
    builtFromTradeCount = result.trades.filter(t => t.result !== 'OPEN').length;
  } else {
    [patternRows, hypothesis] = await Promise.all([
      repo.getPatternMemory(supabase, userId),
      repo.getHypothesis(supabase, userId),
    ]);
    profile = profileRecord.profile;
    builtFromTradeCount = profileRecord.builtFromTradeCount;
  }

  interface Candidate { subject: string; tone: 'positive' | 'caution' | 'neutral'; metric: GroupPerformance; extra?: string }
  const candidates: Candidate[] = [];

  const hypothesisUsable = hypothesis
    && hypothesis.status !== 'insufficient_data' && hypothesis.status !== 'invalidated'
    && hypothesis.confidenceScore >= HYPOTHESIS_DASHBOARD_MIN_CONFIDENCE;
  const anchorPatternId = hypothesisUsable ? hypothesis!.supportingPatternIds[0] ?? null : null;

  if (hypothesisUsable && hypothesis) {
    const topMetric = Object.values(hypothesis.supportingMetrics)[0];
    if (topMetric) {
      candidates.push({
        subject: lang === 'he' ? 'הקצה הנוכחי שלך' : 'Your current edge',
        tone: hypothesis.status === 'weakening' ? 'caution' : 'positive',
        metric: topMetric,
        extra: `hypothesis status ${hypothesis.status}, confidence score ${hypothesis.confidenceScore}/100, built from ${Object.keys(hypothesis.supportingMetrics).length} corroborating pattern(s)`,
      });
    }
  }

  const strongPatterns = patternRows
    .filter(p => p.patternId !== anchorPatternId && (p.status === 'active' || p.status === 'strengthening'))
    .sort((a, b) => b.currentSampleSize - a.currentSampleSize)
    .slice(0, MAX_STRONG_PATTERNS_IN_PANEL);
  for (const p of strongPatterns) {
    candidates.push({ subject: subjectLabelFor(p.subject, lang), tone: 'positive', metric: p.currentMetric });
  }

  const riskiestPattern = patternRows
    .filter(p => p.status === 'weakening')
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  if (riskiestPattern) {
    candidates.push({ subject: subjectLabelFor(riskiestPattern.subject, lang), tone: 'caution', metric: riskiestPattern.currentMetric });
  }

  // Early in a trader's history, every fresh pattern legitimately sits at
  // 'insufficient_data' (below the medium-confidence sample-size floor) —
  // that's correct, not a bug, but it must not mean the panel shows nothing.
  // Fall back to the single largest-sample pattern available, however
  // tentative, and tell the phrasing prompt to treat it as early feedback.
  if (candidates.length === 0) {
    const earliest = patternRows
      .filter(p => p.status !== 'disappeared')
      .sort((a, b) => b.currentSampleSize - a.currentSampleSize)[0];
    if (earliest) {
      candidates.push({
        subject: subjectLabelFor(earliest.subject, lang),
        tone: 'neutral',
        metric: earliest.currentMetric,
        extra: `only ${earliest.currentSampleSize} trades so far — explicitly say this is early feedback, not a strong conclusion yet`,
      });
    }
  }

  // Deeper last resort: the trader's trades are spread thin enough that no
  // single instrument/session/hour combo ever crossed discoverPatterns'
  // 3-trade floor, so pattern_memory is entirely empty. The trader profile's
  // overall numbers only need >=1 closed trade to exist at all, so build one
  // honest, low-confidence insight from those instead of showing nothing.
  if (candidates.length === 0 && builtFromTradeCount > 0) {
    candidates.push({
      subject: lang === 'he' ? 'הביצועים הכוללים שלך' : 'Your overall performance',
      tone: 'neutral',
      metric: {
        key: 'overall', label: 'overall', trades: builtFromTradeCount, wins: 0, losses: 0,
        winRate: profile.winRate.current, totalPnl: 0, avgRR: profile.avgRR.current,
        avgWinner: 0, avgLoser: 0, profitFactor: profile.profitFactor.current,
        confidence: { level: 'low', sampleSize: builtFromTradeCount },
      },
      extra: `only ${builtFromTradeCount} closed trades total so far, not yet enough in any single recurring combination for a specific pattern — explicitly say this is early, overall feedback, not a strong conclusion`,
    });
  }

  const baseDebug = {
    supabaseConfigured: true, hadExistingProfile, patternRowCount: patternRows.length,
    hypothesisStatus: hypothesis?.status ?? null, builtFromTradeCount,
  };

  if (candidates.length === 0) {
    logger.warn('generatePersonalizedInsights: no candidates found', { userId, patternRowCount: patternRows.length, builtFromTradeCount });
    return { insights: [], debug: { ...baseDebug, candidateCount: 0, phrasingSucceeded: null } };
  }
  const trimmed = candidates.slice(0, MAX_PERSONALIZED_INSIGHTS);

  const phrased = await generateInsightsPhrasing(
    trimmed.map(c => ({ subject: c.subject, metric: c.metric, extra: c.extra })),
    lang,
  );
  if (!phrased) {
    logger.warn('generatePersonalizedInsights: phrasing failed, returning empty', { userId, candidateCount: trimmed.length });
    return { insights: [], debug: { ...baseDebug, candidateCount: trimmed.length, phrasingSucceeded: false } };
  }

  const insights = trimmed
    .map((c, i) => ({ subject: c.subject, text: phrased[i] ?? '', tone: c.tone }))
    .filter(i => i.text.length > 0);

  return { insights, debug: { ...baseDebug, candidateCount: trimmed.length, phrasingSucceeded: true } };
}

// ── Evolution Timeline ───────────────────────────────────────────────────────
// Not wired into any UI in this pass — available for a future surface.

export async function getEvolutionTimeline(userId: string): Promise<EvolutionEntry[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getClient();
  const reports = await repo.getRecentWeeklyReports(supabase, userId, 24);
  const records: WeeklyHypothesisRecord[] = reports.map(r => ({
    isoWeek: r.isoWeek, weekStartDate: r.weekStartDate, hypothesis: r.primaryHypothesisSnapshot,
  }));
  return buildEvolutionTimeline(records);
}
