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
import { decidedCounts } from '../calc/decided';
import { generateHypothesisPhrasing, generatePatternPhrasing, metricsEvidence } from '../ai/insightPhrasing';
import { generateNarrativeText, type NarrativeFacts } from '../ai/weeklyNarrative';
import {
  summarizeAnalysis, summarizeComparison, summarizeDepth, summarizeKnownFacts, summarizePatternMemory, summarizeRootCause,
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
// Defined in ./weeklyRules so the on-screen message is built from the same
// number the gate uses — they had drifted apart once already.
import { MIN_TRADES_FOR_WEEKLY } from './weeklyRules';
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

/** True when this row was found in the most recent discovery run.
 *
 *  `currentMetric` and `currentSampleSize` are only current for a pattern the
 *  last run actually saw. For a missed one they are the last observation,
 *  preserved so the row keeps its identity across a noisy run — reading them
 *  as today's numbers is how a claim outlives its trades. Status alone is not
 *  enough to tell the two apart here: these two call sites deliberately reach
 *  past the active/strengthening gate to say something rather than nothing. */
function isObservedNow(row: PatternMemoryRow): boolean {
  return row.consecutiveMisses === 0 && row.status !== 'disappeared';
}

/** How many trades a metric is actually speaking for. `confidence.sampleSize`
 *  is the decided-trade count the statistics were computed over; `trades`
 *  counts the slice including still-open ones. The larger is what the claim
 *  implicitly asserts, so that is what gets checked against reality. */
function sampleOf(metric: GroupPerformance): number {
  return Math.max(metric.confidence?.sampleSize ?? 0, metric.trades ?? 0);
}

/** Options for one refresh pass.
 *
 *  `phrase` is what separates the nightly run from a request. Phrasing a
 *  hypothesis is the one model call in here, and it writes prose in a
 *  particular language — the language of whoever asked. The nightly run has
 *  nobody to ask, so it leaves the description empty and the next request,
 *  which knows the language, writes it. Everything else in the refresh is
 *  deterministic and belongs to the night. */
interface RefreshOptions {
  phrase?: boolean;
}

async function refreshIntelligence(
  supabase: SupabaseClient,
  userId: string,
  lang: 'he' | 'en',
  opts: RefreshOptions = {},
): Promise<RefreshResult> {
  const phrase = opts.phrase ?? true;
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
  if (phrase && hypothesis.description === null && hypothesis.status !== 'insufficient_data' && hypothesis.status !== 'invalidated') {
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

/** Shared by generateDashboardPrimaryInsight and generatePersonalizedInsights.
 *
 *  This used to skip the refresh whenever the stored closed-trade count still
 *  matched the current one, and read the persisted pattern_memory / hypothesis
 *  rows instead. The count is not a freshness test. It agrees again the moment
 *  a refresh runs, which froze the stored rows exactly as that run left them —
 *  including mid-grace-period rows still carrying the sample size and win rate
 *  of trades that had since been deleted. Nothing would ever recompute them,
 *  because the only trigger was the number changing again, and it never did.
 *  A trader with three trades kept being told about nineteen.
 *
 *  So: always rebuild. It is cheap — a handful of queries plus pure
 *  computation over trades this function already had to load. The expensive
 *  part, the model call that phrases a hypothesis, is gated separately inside
 *  refreshIntelligence on the hypothesis IDENTITY changing, and the panels
 *  themselves only reach this route when their own cache misses. */
async function getFreshIntelligence(
  supabase: SupabaseClient,
  userId: string,
  lang: 'he' | 'en',
  _profileRecord: Awaited<ReturnType<typeof repo.getTraderProfile>>,
): Promise<FreshIntelligence> {
  const result = await refreshIntelligence(supabase, userId, lang);
  return {
    patternRows: result.patternRows, hypothesis: result.hypothesis, profile: result.profile,
    builtFromTradeCount: result.trades.filter(t => t.result !== 'OPEN').length,
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

/** The nightly pass over the descriptive stack.
 *
 *  WHY THIS EXISTS
 *
 *  The whole of lib/intelligence — the trader profile, pattern memory, the
 *  hypothesis, the edge and learning scores, the known facts — is written by
 *  `refreshIntelligence`, and of the entry points that reach it exactly one
 *  was wired into the app: the weekly report route. Everything this stack
 *  stores updated only when a trader opened one panel, and only when that
 *  week's trade count had changed since the last time they did.
 *
 *  Which made every claim it stores about time untrue. A pattern is marked
 *  `weakening` relative to the previous stored row, so "weakening" meant
 *  "weaker than the last time you opened the report" — a fortnight or a day,
 *  with nothing to say which. The edge score blends 70/30 against its own
 *  previous value so it moves gradually, a design that assumes the updates
 *  are regular. The learning score compares the first half of the score
 *  history against the second, and the points in that history were page
 *  visits.
 *
 *  Run nightly, the same numbers mean "since yesterday" for everyone, which
 *  is the thing they were always presented as meaning. */
export async function refreshIntelligenceNightly(userId: string): Promise<{ patternRows: number }> {
  if (!isSupabaseConfigured()) return { patternRows: 0 };
  const result = await refreshIntelligence(getClient(), userId, DEFAULT_LANG, { phrase: false });
  return { patternRows: result.patternRows.length };
}

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
  // Decided, not merely closed. The floor is named for decided trades and the
  // comparison it gates is a win/loss test — counting break-evens toward it
  // let a week of six decided trades and three scratches pass as nine.
  const prevClosed = decidedCounts(windows.prevWeekTrades).decided;
  const baselineClosed = decidedCounts(windows.baselineTrades).decided;
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
  // Decided, not merely closed. The floor is named for decided trades and the
  // comparison it gates is a win/loss test — counting break-evens toward it
  // let a week of six decided trades and three scratches pass as nine.
  const prevClosed = decidedCounts(windows.prevWeekTrades).decided;
  const baselineClosed = decidedCounts(windows.baselineTrades).decided;
  const prevAnalysis = prevClosed >= MIN_TRADES_FOR_COMPARISON ? runFullAnalysis(windows.prevWeekTrades) : null;
  const baselineAnalysis = baselineClosed >= MIN_BASELINE_TRADES ? runFullAnalysis(windows.baselineTrades) : null;
  const comparison = computePeriodComparison(thisAnalysis, prevAnalysis, baselineAnalysis);

  const rootCause = diagnoseRootCause(
    comparison, result.profile, previousProfileRecord?.profile ?? null,
    // Both sides decided, matching the floor's own definition — the mechanism
    // is a claim about wins and losses, and a scratch is neither.
    { thisWeek: decidedCounts(closedThisWeek).decided, prevWeek: prevClosed },
  );

  const priorReports = await repo.getRecentWeeklyReports(supabase, userId, MIN_PRIOR_REPORTS_FOR_FULL_CONFIDENCE + 1);
  const isEarlyInHistory = priorReports.length < MIN_PRIOR_REPORTS_FOR_FULL_CONFIDENCE;
  const confidenceLevel = isEarlyInHistory
    ? downgradeConfidence(thisAnalysis.performance.confidence.level)
    : thisAnalysis.performance.confidence.level;

  const facts: NarrativeFacts = {
    // The depth layer, scoped explicitly to the week. Without the label the
    // model would read a within-the-week longest streak as a career figure.
    thisWeekSummary: `${summarizeAnalysis(thisAnalysis)}\n\n${summarizeDepth(thisAnalysis, 'THIS WEEK ONLY')}`,
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

// ── Scores, read-only ────────────────────────────────────────────────────────

/** The stored score history, without recomputing anything.
 *
 *  READ-ONLY ON PURPOSE. Every other entry point into this module refreshes
 *  the intelligence as a side effect of being asked a question — which is
 *  right for a nightly job and wrong for a screen. Opening the progress page
 *  must not spend a model call, must not move the trader's stored state, and
 *  must not let a page load rewrite the very history the page is drawing.
 *
 *  Returns an empty history rather than throwing for an account the nightly
 *  run has never touched. */
export async function getScoreHistory(userId: string): Promise<ScoreSnapshot[]> {
  if (!isSupabaseConfigured()) return [];
  const record = await repo.getTraderProfile(getClient(), userId);
  return record?.scoreHistory ?? [];
}

export async function generateDashboardPrimaryInsight(userId: string, lang: 'he' | 'en' = DEFAULT_LANG): Promise<AiDiscovery | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getClient();

  const profileRecord = await repo.getTraderProfile(supabase, userId);
  const { patternRows, hypothesis, builtFromTradeCount } = await getFreshIntelligence(supabase, userId, lang, profileRecord);

  // Same arithmetic floor the journal panel applies: a claim resting on more
  // trades than exist is not a weak reading, it is a stale row. Checked here
  // too because this screen has its OWN phrasing cache — a title written when
  // the numbers were real outlives them otherwise.
  const grounded = patternRows.filter(p => sampleOf(p.currentMetric) <= builtFromTradeCount);

  const hypothesisSample = Object.values(hypothesis?.supportingMetrics ?? {})
    .reduce((max, m) => Math.max(max, sampleOf(m)), 0);
  const hypothesisIsUsable = hypothesis
    && hypothesis.status !== 'insufficient_data'
    && hypothesis.status !== 'invalidated'
    && hypothesis.confidenceScore >= HYPOTHESIS_DASHBOARD_MIN_CONFIDENCE
    && hypothesisSample <= builtFromTradeCount;

  if (hypothesis && hypothesisSample > builtFromTradeCount) {
    logger.warn('dropped dashboard hypothesis claiming more trades than exist', {
      userId, builtFromTradeCount, claimed: hypothesisSample,
    });
  }

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

  const anchor = selectPrimaryPattern(grounded);
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

// ── Evolution Timeline ───────────────────────────────────────────────────────
// Surfaced by /dashboard/progress. It sat here unwired for long enough to grow
// a comment saying so.

export async function getEvolutionTimeline(userId: string): Promise<EvolutionEntry[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getClient();
  const reports = await repo.getRecentWeeklyReports(supabase, userId, 24);
  const records: WeeklyHypothesisRecord[] = reports.map(r => ({
    isoWeek: r.isoWeek, weekStartDate: r.weekStartDate, hypothesis: r.primaryHypothesisSnapshot,
  }));
  return buildEvolutionTimeline(records);
}
