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
import { MIN_DECIDED_FOR_CLAIM } from '../stats/evidence';
import { generateHypothesisPhrasing, generateInsightsPhrasing, generatePatternPhrasing, generateWorkingStrengthsPhrasing, metricsEvidence } from '../ai/insightPhrasing';
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
  PatternStatus, PeriodComparison, ScoreSnapshot, TraderProfile,
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
/** Decided trades this week before a weekly report is written at all. Three
    was the old bar, inherited from weeklyReport.ts. Describing a three-trade
    week is fine; the report's whole structure is comparison, and a three-trade
    week compared against another one is noise with a narrative on top. */
const MIN_TRADES_FOR_WEEKLY = 5;
/** Decided trades a PREVIOUS week needs before it is used as a comparison.
    Higher than the bar for writing the report: a thin week can still be
    described, it just cannot be measured against. Shared floor — see
    lib/stats/evidence. */
const MIN_TRADES_FOR_COMPARISON = MIN_DECIDED_FOR_CLAIM;
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
      userId,
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

interface FreshIntelligence {
  patternRows: PatternMemoryRow[];
  hypothesis: HypothesisState | null;
  profile: TraderProfile;
  builtFromTradeCount: number;
}

/** Shared by generateDashboardPrimaryInsight and generatePersonalizedInsights:
    a stored trader_profiles row existing is NOT the same as it being
    current. If the profile was built (e.g. bootstrapped) before real trades
    had synced — or trades were added/edited/removed since — its
    built_from_trade_count no longer matches the actual closed-trade count,
    and reading the stale stored pattern_memory/hypothesis forever would
    silently freeze the whole insight pipeline. Re-runs the full refresh
    whenever that mismatch is detected, not just on a true cold start. */
async function getFreshIntelligence(
  supabase: SupabaseClient,
  userId: string,
  lang: 'he' | 'en',
  profileRecord: Awaited<ReturnType<typeof repo.getTraderProfile>>,
): Promise<FreshIntelligence> {
  if (!profileRecord) {
    const result = await refreshIntelligence(supabase, userId, lang);
    return {
      patternRows: result.patternRows, hypothesis: result.hypothesis, profile: result.profile,
      builtFromTradeCount: result.trades.filter(t => t.result !== 'OPEN').length,
    };
  }

  const trades = await repo.getRecentTrades(supabase, userId);
  const closedCount = trades.filter(t => t.result !== 'OPEN').length;
  if (closedCount !== profileRecord.builtFromTradeCount) {
    const result = await refreshIntelligence(supabase, userId, lang);
    return {
      patternRows: result.patternRows, hypothesis: result.hypothesis, profile: result.profile,
      builtFromTradeCount: result.trades.filter(t => t.result !== 'OPEN').length,
    };
  }

  const [patternRows, hypothesis] = await Promise.all([
    repo.getPatternMemory(supabase, userId),
    repo.getHypothesis(supabase, userId),
  ]);
  return { patternRows, hypothesis, profile: profileRecord.profile, builtFromTradeCount: profileRecord.builtFromTradeCount };
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
  const prevAnalysis = prevClosed >= MIN_TRADES_FOR_COMPARISON ? runFullAnalysis(windows.prevWeekTrades) : null;
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
  const prevAnalysis = prevClosed >= MIN_TRADES_FOR_COMPARISON ? runFullAnalysis(windows.prevWeekTrades) : null;
  const baselineAnalysis = baselineClosed >= MIN_BASELINE_TRADES ? runFullAnalysis(windows.baselineTrades) : null;
  const comparison = computePeriodComparison(thisAnalysis, prevAnalysis, baselineAnalysis);

  const rootCause = diagnoseRootCause(
    comparison, result.profile, previousProfileRecord?.profile ?? null,
    { thisWeek: closedThisWeek.length, prevWeek: prevClosed },
  );

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

  const narrative = await generateNarrativeText(facts, lang, userId);
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
  const { patternRows, hypothesis } = await getFreshIntelligence(supabase, userId, lang, profileRecord);

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
        userId,
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
      // Rebuilt from the metrics rather than read back from the row. The
      // stored string was written by a model — older rows carry an English
      // sentence, and a hypothesis keeps its phrasing until its identity
      // changes, so trusting the column would keep printing English for weeks.
      // The numbers are the same either way; only who typed them changed.
      evidence: metricsEvidence(hypothesis.supportingMetrics, lang === 'he') || (evidence ?? ''),
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

  const phrased = await generatePatternPhrasing(anchor, lang, userId);
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

// Confirmation tags are the trader's own short ICT-style acronyms (SMT, IFVG,
// CISD) — kept verbatim, same convention as HEBREW_MENTOR_STYLE's "instrument
// tickers and confirmation tags stay exactly as typed" rule. Only the one tag
// with a real English phrase gets expanded.
const CONFIRMATION_TAG_LABEL: Record<string, string> = { ORDER_BLOCK: 'Order Block' };
const confirmationTagLabel = (tag: string) => CONFIRMATION_TAG_LABEL[tag] ?? tag;

const EMOTION_HE: Record<string, string> = {
  CALM: 'רגוע', CONFIDENT: 'בטוח', STRESSED: 'לחוץ', FOMO: 'FOMO', TIRED: 'עייף', ANGRY: 'כועס', IMPATIENT: 'חסר סבלנות',
};
const EMOTION_EN: Record<string, string> = {
  CALM: 'Calm', CONFIDENT: 'Confident', STRESSED: 'Stressed', FOMO: 'FOMO', TIRED: 'Tired', ANGRY: 'Angry', IMPATIENT: 'Impatient',
};
const WEEKDAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function subjectLabelFor(subject: Record<string, string | number>, lang: 'he' | 'en'): string {
  const parts: string[] = [];
  if (subject.instrument) parts.push(String(subject.instrument));
  if (subject.confirmation) parts.push(String(subject.confirmation));
  if (subject.confirmationTag) parts.push(confirmationTagLabel(String(subject.confirmationTag)));
  if (subject.confirmationCombo) parts.push(String(subject.confirmationCombo).split('+').map(confirmationTagLabel).join(' + '));
  if (subject.session) {
    const s = SESS.find(x => x.key === subject.session);
    parts.push(s ? (lang === 'he' ? s.he : s.en) : String(subject.session));
  }
  if (subject.direction) parts.push(subject.direction === 'LONG' ? (lang === 'he' ? 'לונג' : 'Long') : (lang === 'he' ? 'שורט' : 'Short'));
  if (subject.hour !== undefined) parts.push(`${String(subject.hour).padStart(2, '0')}:00`);
  if (subject.emotion) parts.push((lang === 'he' ? EMOTION_HE : EMOTION_EN)[String(subject.emotion)] ?? String(subject.emotion));
  if (subject.biasAlignment) {
    parts.push(subject.biasAlignment === 'ALIGNED' ? (lang === 'he' ? 'עם הביאס' : 'With the bias') : (lang === 'he' ? 'נגד הביאס' : 'Against the bias'));
  }
  if (subject.setup) {
    parts.push(subject.setup === 'REVERSAL' ? (lang === 'he' ? 'סטאפ היפוך' : 'Reversal setup') : (lang === 'he' ? 'סטאפ המשך' : 'Continuation setup'));
  }
  if (subject.weekday !== undefined) {
    const w = Number(subject.weekday);
    parts.push(lang === 'he' ? `ימי ${WEEKDAY_HE[w]}` : `${WEEKDAY_EN[w]}s`);
  }
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
  const { patternRows, hypothesis, profile, builtFromTradeCount } = await getFreshIntelligence(supabase, userId, lang, profileRecord);

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
        extra: `${earliest.currentSampleSize} trades so far — say something genuinely specific about what this shows, exactly like you would with a larger sample; a brief, natural mention that the sample is still small is fine, but that must not be the main point or opening line of the insight`,
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
      extra: `${builtFromTradeCount} closed trades total so far, spread across different conditions so no single recurring combination has repeated enough times yet for its own pattern — describe what the OVERALL numbers genuinely show (win rate, RR, PF) as real, specific feedback; a brief, natural mention that a specific repeating edge hasn't emerged yet is fine, but that must not be the main point or opening line`,
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
    userId,
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

// ── generateWorkingStrengths ──────────────────────────────────────────────────
// "מה באמת עובד לך" — the flagship AI-analytics section. Unlike
// generatePersonalizedInsights (picks ONE best-supported story for the
// dashboard), this surfaces every genuine, above-baseline recurring pattern
// pattern_memory currently tracks for the trader, each with its own real
// trend (strengthening/stable/weakening — the same status pattern_memory
// already maintains across visits, not a single-session guess) so the trader
// sees the full set of things that actually work, not just the single
// headline pattern.

export type StrengthTrend = 'up' | 'flat' | 'down';

export interface WorkingStrength {
  id: string;
  /** Deterministic Hebrew/English label built from the pattern's subject —
      never AI-generated, so it never disappears if phrasing fails. */
  name: string;
  metric: GroupPerformance;
  baseline: number;
  delta: number;
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
  trend: StrengthTrend;
  /** Up to 12 rolling snapshots (win rate + sample size over time) already
      tracked by pattern_memory — powers a small trend chart, never invented. */
  history: { at: string; winRate: number; sampleSize: number }[];
  /** True when confidence is still too low to claim a trend at all — the
      explanation is then a fixed disclaimer, never an AI-invented conclusion. */
  isLowData: boolean;
  explanation: string;
}

const MAX_WORKING_STRENGTHS = 6;
/** Percentage points above the trader's own baseline win rate required to
    count as a genuine strength — never invented, always measured against
    the same baseline pattern_memory already stores per row. */
const MIN_STRENGTH_DELTA = 5;
const CONF_RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };

function trendForStatus(status: PatternStatus): StrengthTrend {
  if (status === 'strengthening') return 'up';
  if (status === 'weakening') return 'down';
  return 'flat';
}

const LOW_DATA_DISCLAIMER: Record<'he' | 'en', string> = {
  he: 'עדיין אין מספיק נתונים כדי להסיק מסקנה אמינה.',
  en: 'Not enough data yet for a reliable conclusion.',
};

export async function generateWorkingStrengths(userId: string, lang: 'he' | 'en' = DEFAULT_LANG): Promise<WorkingStrength[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getClient();

  const profileRecord = await repo.getTraderProfile(supabase, userId);
  const { patternRows } = await getFreshIntelligence(supabase, userId, lang, profileRecord);

  // A "strength" is a pattern that's both still live and genuinely above the
  // trader's own baseline — never a weak or negative slice, no matter how
  // large its sample. discoverPatterns deliberately crosses many dimensions
  // (instrument+session, instrument_best, hour+instrument, ...), so the exact
  // same underlying trades can surface under several different pattern kinds
  // at once — dedupe by the metric's own fingerprint (identical sample size +
  // win rate + PnL is, in practice, the same subset) before capping, so the
  // trader never sees the same 10 trades presented as 3 "different" strengths.
  const seenFingerprints = new Set<string>();
  const strengths = patternRows
    .filter(p => p.status !== 'disappeared' && p.delta >= MIN_STRENGTH_DELTA)
    .filter(p => {
      const fp = `${p.currentSampleSize}:${p.currentMetric.winRate.toFixed(2)}:${p.currentMetric.totalPnl.toFixed(2)}`;
      if (seenFingerprints.has(fp)) return false;
      seenFingerprints.add(fp);
      return true;
    })
    .sort((a, b) => {
      const tierDiff = CONF_RANK[b.currentConfidenceLevel] - CONF_RANK[a.currentConfidenceLevel];
      return tierDiff !== 0 ? tierDiff : b.delta - a.delta;
    })
    .slice(0, MAX_WORKING_STRENGTHS);

  if (strengths.length === 0) return [];

  // Patterns still at 'insufficient_data' get a fixed disclaimer instead of an
  // AI-phrased trend claim — nothing to send to the model for those.
  const toPhrase = strengths.filter(p => p.status !== 'insufficient_data');
  const phrased = toPhrase.length > 0
    ? await generateWorkingStrengthsPhrasing(
        toPhrase.map(p => ({
          subjectLabel: subjectLabelFor(p.subject, lang),
          metric: p.currentMetric,
          baseline: p.baselineWinRate,
          trend: trendForStatus(p.status),
        })),
        lang,
        userId,
      )
    : [];
  const explanationById = new Map(toPhrase.map((p, i) => [p.patternId, phrased?.[i] ?? '']));

  return strengths
    .map((p): WorkingStrength => ({
      id: p.patternId,
      name: subjectLabelFor(p.subject, lang),
      metric: p.currentMetric,
      baseline: p.baselineWinRate,
      delta: p.delta,
      confidenceLevel: p.currentConfidenceLevel,
      sampleSize: p.currentSampleSize,
      trend: trendForStatus(p.status),
      history: p.history.map(h => ({ at: h.at, winRate: h.winRate, sampleSize: h.sampleSize })),
      isLowData: p.status === 'insufficient_data',
      explanation: p.status === 'insufficient_data' ? LOW_DATA_DISCLAIMER[lang] : (explanationById.get(p.patternId) ?? ''),
    }))
    .filter(s => s.explanation.length > 0);
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
