// ─────────────────────────────────────────────────────────────────────────────
// generateDailyInsight — the pipeline's headline function.
//
// Given a user + a date, it:
//   1. Checks the kill switch.
//   2. Refuses to re-generate an existing (clerkId, date, kind) insight.
//   3. Loads context: whole-history stats, today's trades, today's signals,
//      past_writing
//      block from RAG retrieval.
//   4. Decides provider (Claude vs Gemini fallback) based on the user's
//      monthly spend + the system-wide daily budget.
//   5. Calls the chosen provider. On a Claude failure that isn't a hard
//      budget breach, tries Gemini as a rescue.
//   6. Persists to daily_insights + logs usage.
//
// Never throws. Every outcome is a discriminated union.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';

import type { DailyInsightRow, FallbackReason, InsightKind, Provider, Statistical, TradeRow } from '../types';
import { listTradesForDate, listRecentTrades, listLateLoggedTrades } from '../db/trades';
import { getInsightForDate, insertInsight, listRecentInsights } from '../db/insights';
import { loadRuleBreaches } from '../db/collections';
import { rankRuleBreaches, type RuleBreach } from '../analyzers/rulesBroken';
import { computeLoggingHabit, computePlanExecution } from '../analyzers/planExecution';
import { logUsage, sumUserMonthlyCost, sumSystemCostSince } from '../db/usage';
import { flags } from '../db/flags';
import { callClaudeInsight, CLAUDE_MODEL } from '../providers/anthropic';
import { callGeminiInsight, GEMINI_INSIGHT_MODEL } from '../providers/google';
import {
  SYSTEM_PROMPT, GEMINI_STRICT_ADDENDUM, DAILY_INSIGHT_PROMPT_VERSION, buildUserMessage,
} from '../prompts/dailyInsight';
import { computeTodaySignals } from '../analyzers/todaySignals';
import { computeStatistical } from '../analyzers/statistical';
import { retrievePastWriting } from './retrievePastWriting';
import { analyzeBehavior } from './analyzeBehavior';
import { checkInsight, hasHardViolation, buildCorrection } from '../quality/insightCheck';
import { requireClerkId } from '../db/client';
import { traderProfileBlock } from '../../settings/server';
import { logger } from '../../logger';

export type PlanTier = 'free' | 'starter' | 'pro' | 'deluxe';

export interface GenerateInputs {
  clerkId:  string;
  date:     string;                // 'YYYY-MM-DD' in Israel time
  planTier: PlanTier;              // caller (cron) supplies this so we don't ping Clerk
  kind?:    InsightKind;           // default 'daily'
}

export type GenerateOutcome =
  // `primaryError` carries Claude's failure message on a rescued run. Without
  // it a fallback is indistinguishable from a healthy run except for the
  // provider field — the pipeline reports success while never once reaching
  // the model it is supposed to be using, and the reason is buried in a log
  // line nobody reads.
  | { status: 'ok';       row: DailyInsightRow; provider: Provider; fallbackReason?: FallbackReason; primaryError?: string }
  | { status: 'exists';   row: DailyInsightRow }                        // insight already exists for this user+day+kind
  | { status: 'disabled' }                                              // kill switch off
  | { status: 'ineligible'; reason: 'free_plan' | 'starter_plan' }      // analysis starts at pro
  | { status: 'failed';   reason: string }
  | { status: 'both_providers_down'; claudeError: string; geminiError: string };

// ── Budget helpers ──────────────────────────────────────────────────────────

async function monthlyCapForPlan(plan: PlanTier): Promise<number> {
  switch (plan) {
    case 'starter': return flags.userMonthlyCapStarterUsd();
    case 'pro':     return flags.userMonthlyCapProUsd();
    case 'deluxe':  return flags.userMonthlyCapDeluxeUsd();
    default:        return Promise.resolve(0);
  }
}

function startOfCurrentMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function startOfIsraelTodayUtc(dateIso: string): string {
  // Israel is UTC+2 (winter) or UTC+3 (summer). "Start of today Israel" is
  // ~21:00 or 22:00 UTC the previous day. For a budget-alarm read we don't
  // need to be exact — a 3-hour rolling window either way still catches
  // today's real cost. Use midnight UTC of the given date as a stable proxy.
  return `${dateIso}T00:00:00Z`;
}

interface BudgetState {
  userSpendUsd:  number;
  userCapUsd:    number;
  systemSpendUsd: number;
  systemCapUsd:  number;
  state:         'normal' | 'user_over' | 'system_over';
}

async function checkBudget(clerkId: string, plan: PlanTier, date: string): Promise<BudgetState> {
  const [userCap, systemCap, userSpend, systemSpend] = await Promise.all([
    monthlyCapForPlan(plan),
    flags.dailyBudgetAlarmUsd(),
    sumUserMonthlyCost(clerkId, startOfCurrentMonthUtc()),
    sumSystemCostSince(startOfIsraelTodayUtc(date)),
  ]);
  const state: BudgetState['state'] =
    userSpend  >= userCap   ? 'user_over'   :
    systemSpend >= systemCap ? 'system_over' :
    'normal';
  return { userSpendUsd: userSpend, userCapUsd: userCap, systemSpendUsd: systemSpend, systemCapUsd: systemCap, state };
}

// ── Hashing ─────────────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// ── Orchestrator ────────────────────────────────────────────────────────────

export async function generateDailyInsight(inputs: GenerateInputs): Promise<GenerateOutcome> {
  const cid  = requireClerkId(inputs.clerkId);
  const kind = inputs.kind ?? 'daily';

  // 0. Analysis starts at pro.
  //
  //    Starter buys the journal — the log, the notebook, the setups, the
  //    rules, the statistics over what was written. Not the AI. Checked here
  //    as well as at enqueue time because this is the function that spends
  //    money: a hand-inserted job, a replayed row or a future caller must not
  //    be able to run a model on an account that did not buy one.
  if (inputs.planTier === 'free' || inputs.planTier === 'starter') {
    return { status: 'ineligible', reason: `${inputs.planTier}_plan` };
  }

  // 1. Kill switch.
  if (!(await flags.aiPipelineEnabled())) {
    return { status: 'disabled' };
  }

  // 2. Idempotency — if we already have one for today, return it.
  const existing = await getInsightForDate(cid, inputs.date, kind);
  if (existing) return { status: 'exists', row: existing };

  // 3. Load context in parallel where possible.
  const [todayTrades, traderProfile] = await Promise.all([
    listTradesForDate(cid, inputs.date),
    // What the trader wrote about themselves. Never throws — an absent bio
    // shortens the prompt, it does not fail the night's run.
    traderProfileBlock(cid).catch(() => ''),
  ]);
  const signals = computeTodaySignals(todayTrades);

  // Trades the trader logged since the last note went out, for other days.
  // A trade's `date` is when it happened; `created_at` is when it was written
  // down. Log Tuesday's trade on Friday and no note ever remarks on it —
  // Tuesday's was filed before it existed and is never rewritten, and Friday's
  // is correctly about Friday. This is where the coach gets to notice it.
  //
  // Never fails the run: a note without this block is the note as it was.
  let lateLogged: TradeRow[] = [];
  try {
    const [previous] = await listRecentInsights(cid, 1);
    // No previous note means this is the trader's first — everything is new,
    // and a "you logged these late" block on a first note is nonsense.
    if (previous?.generated_at) {
      lateLogged = await listLateLoggedTrades(cid, inputs.date, previous.generated_at);
    }
  } catch (err) {
    logger.warn('late-logged lookup failed — continuing without it', {
      clerkId: cid, error: err instanceof Error ? err.message : String(err),
    });
  }

  // Who this trader is, in numbers. Computed here from their real history:
  // deterministic, free, and no number in it was invented.
  //
  // This used to be a fallback. The block was supposed to be filled from a
  // rolling profile kept by a background agent, and the agent was never
  // built — nothing in the app ever wrote a user_profile row — so the
  // fallback ran every night for every trader while the read that preceded it
  // returned nothing, every time. What was the exception is the rule, and now
  // says so.
  let statistical: Statistical | undefined;
  try {
    const history = await listRecentTrades(cid, 200);
    if (history.length) statistical = computeStatistical(history, { today: inputs.date });
  } catch (err) {
    // Missing numbers degrade the insight; they must never kill the run.
    logger.warn('statistical block failed — continuing without it', {
      clerkId: cid, error: err instanceof Error ? err.message : String(err),
    });
  }

  // The plan against the execution, and how promptly the journal gets filled.
  // Both read the recent window rather than the reported day: a capture rate
  // built on one session is a number that will be quoted and should not exist.
  let planExecution: ReturnType<typeof computePlanExecution> = null;
  let loggingHabit: ReturnType<typeof computeLoggingHabit> = null;
  try {
    const window = await listRecentTrades(cid, 60);
    planExecution = computePlanExecution(window);
    loggingHabit = computeLoggingHabit(window);
  } catch (err) {
    logger.warn('plan/logging window failed — continuing without it', {
      clerkId: cid, error: err instanceof Error ? err.message : String(err),
    });
  }

  // The trader's own rules, by name, and the plan they wrote that morning.
  // Both live in user_collections, which nothing on the server had ever read —
  // the ticks and the sentence were being stored and never opened. Neither can
  // fail the run: a missing block is a shorter note.
  let rulesBroken: RuleBreach[] = [];
  try {
    const { rules, breaches } = await loadRuleBreaches(cid);
    rulesBroken = rankRuleBreaches(rules, breaches, inputs.date);
  } catch (err) {
    logger.warn('rule breaches lookup failed — continuing without them', {
      clerkId: cid, error: err instanceof Error ? err.message : String(err),
    });
  }

  // Retrieval — never throws, always returns a well-formed empty on failure.
  const retrieval = await retrievePastWriting(cid, todayTrades);

  // The behaviour layer. This is where it writes: the nightly run is the
  // cadence the lifecycle is measured in, and running it here means the state
  // the insight was written from is the state that got stored. Never throws;
  // an empty block produces a shorter, honest note rather than a failed run.
  const behavior = await analyzeBehavior(cid, { persist: true });

  // 4. Budget decision.
  const budget = await checkBudget(cid, inputs.planTier, inputs.date);

  // Provider order: if the user or system is already over budget, jump
  // straight to Gemini and skip Claude entirely.
  const preferGemini = budget.state !== 'normal';
  const primary:  Provider = preferGemini ? 'google' : 'anthropic';
  const primaryFallbackReason: FallbackReason | undefined =
    budget.state === 'user_over'   ? 'budget_cap' :
    budget.state === 'system_over' ? 'system_budget_alarm' :
    undefined;

  // 5. Build prompt.
  const userMessage = buildUserMessage({
    todayTrades,
    signals,
    pastWritingBlock: retrieval.block,
    lateLogged,
    planExecution,
    logging: loggingHabit,
    rulesBroken,
    statistical,
    behavior: behavior.block,
    traderProfile,
  });

  // 6. Run the primary. If primary is Claude and it fails, try Gemini once
  //    as a rescue (mark fallback_reason with the transport error kind).
  let usedProvider: Provider = primary;
  let usedText:     string | null = null;
  let usedTokensIn  = 0;
  let usedTokensOut = 0;
  let usedCostUsd   = 0;
  let usedLatency   = 0;
  let usedFallbackReason: FallbackReason | undefined = primaryFallbackReason;
  let usedModel: string;
  let primaryError: string | undefined;

  if (primary === 'anthropic') {
    const c = await callClaudeInsight(SYSTEM_PROMPT, userMessage);
    if (c.ok) {
      usedProvider = 'anthropic';
      usedModel    = CLAUDE_MODEL;
      usedText     = c.text;
      usedTokensIn = c.tokensIn; usedTokensOut = c.tokensOut;
      usedCostUsd  = c.costUsd;  usedLatency   = c.latencyMs;
      await logUsage({
        clerkId: cid, provider: 'anthropic', model: CLAUDE_MODEL,
        purpose: 'daily_insight',
        tokensIn: c.tokensIn, tokensOut: c.tokensOut, costUsdEst: c.costUsd,
        latencyMs: c.latencyMs, ok: true,
      });
    } else {
      // Claude failed for a transport reason (rate/timeout/5xx/other).
      // Log the failed call, then try Gemini as a rescue.
      await logUsage({
        clerkId: cid, provider: 'anthropic', model: CLAUDE_MODEL,
        purpose: 'daily_insight',
        tokensIn: 0, tokensOut: 0, costUsdEst: 0,
        latencyMs: c.latencyMs, ok: false, errorKind: c.errorKind,
      });
      logger.warn('claude failed → trying gemini fallback', { clerkId: cid, kind: c.errorKind });
      const claudeErrMessage = c.message;
      primaryError = `${CLAUDE_MODEL} ${c.errorKind}${c.status ? ` (${c.status})` : ''}: ${c.message.slice(0, 300)}`;

      const g = await callGeminiInsight(SYSTEM_PROMPT + GEMINI_STRICT_ADDENDUM, userMessage);
      if (g.ok) {
        usedProvider = 'google';
        usedModel    = GEMINI_INSIGHT_MODEL;
        usedText     = g.text;
        usedTokensIn = g.tokensIn; usedTokensOut = g.tokensOut;
        usedCostUsd  = g.costUsd;  usedLatency   = g.latencyMs;
        // Normalize claude's 'other' bucket to 'api_error' so it fits FallbackReason.
        usedFallbackReason = c.errorKind === 'other' ? 'api_error' : c.errorKind;
        await logUsage({
          clerkId: cid, provider: 'google', model: GEMINI_INSIGHT_MODEL,
          purpose: 'daily_insight',
          tokensIn: g.tokensIn, tokensOut: g.tokensOut, costUsdEst: g.costUsd,
          latencyMs: g.latencyMs, ok: true,
        });
      } else {
        await logUsage({
          clerkId: cid, provider: 'google', model: GEMINI_INSIGHT_MODEL,
          purpose: 'daily_insight',
          tokensIn: 0, tokensOut: 0, costUsdEst: 0,
          latencyMs: g.latencyMs, ok: false, errorKind: g.errorKind,
        });
        logger.error('both providers failed for daily insight', {
          clerkId: cid, claude: c.errorKind, gemini: g.errorKind,
        });
        return { status: 'both_providers_down', claudeError: claudeErrMessage, geminiError: g.message };
      }
    }
  } else {
    // Primary is Gemini because budget forced it. No Claude rescue path —
    // that would defeat the point of the budget cap.
    const g = await callGeminiInsight(SYSTEM_PROMPT + GEMINI_STRICT_ADDENDUM, userMessage);
    if (g.ok) {
      usedProvider = 'google';
      usedModel    = GEMINI_INSIGHT_MODEL;
      usedText     = g.text;
      usedTokensIn = g.tokensIn; usedTokensOut = g.tokensOut;
      usedCostUsd  = g.costUsd;  usedLatency   = g.latencyMs;
      await logUsage({
        clerkId: cid, provider: 'google', model: GEMINI_INSIGHT_MODEL,
        purpose: 'daily_insight',
        tokensIn: g.tokensIn, tokensOut: g.tokensOut, costUsdEst: g.costUsd,
        latencyMs: g.latencyMs, ok: true,
      });
    } else {
      await logUsage({
        clerkId: cid, provider: 'google', model: GEMINI_INSIGHT_MODEL,
        purpose: 'daily_insight',
        tokensIn: 0, tokensOut: 0, costUsdEst: 0,
        latencyMs: g.latencyMs, ok: false, errorKind: g.errorKind,
      });
      return { status: 'failed', reason: `gemini ${g.errorKind}: ${g.message.slice(0, 200)}` };
    }
  }

  // 7. Sanity — Gemini can return empty text on refusal even when ok=true.
  if (!usedText || !usedText.trim()) {
    logger.warn('provider returned empty text', { clerkId: cid, provider: usedProvider });
    return { status: 'failed', reason: 'empty text from provider' };
  }

  // 7b. Check the output against the rules that can be checked, and spend one
  //     retry on a hard violation.
  //
  //     A rule that only produces a log line is a rule nobody enforces. The
  //     two failures this catches — the generic coaching sentence, and the
  //     model explaining the trader's psychology to them — both read perfectly
  //     well, so neither would ever be noticed by someone skimming the output.
  //
  //     Exactly one retry, and it publishes either way. Silence is worse than
  //     an imperfect note, and a second rewrite tends to produce a blander one
  //     than the first. The violations are stored on the row regardless, so
  //     quality is a number rather than an impression.
  let violations = checkInsight(usedText, behavior.block);
  let retried = false;

  if (hasHardViolation(violations)) {
    retried = true;
    logger.warn('insight broke output rules — retrying once', {
      clerkId: cid, rules: violations.filter(v => v.severity === 'hard').map(v => v.rule),
    });
    const corrected = userMessage + buildCorrection(violations);
    const r = usedProvider === 'anthropic'
      ? await callClaudeInsight(SYSTEM_PROMPT, corrected)
      : await callGeminiInsight(SYSTEM_PROMPT + GEMINI_STRICT_ADDENDUM, corrected);

    if (r.ok && r.text.trim()) {
      const retryViolations = checkInsight(r.text, behavior.block);
      // Keep the rewrite only if it is actually better. A retry that trades a
      // causal claim for a generic one is not an improvement, and a checker
      // that can be satisfied by getting worse is worse than none.
      if (retryViolations.length < violations.length) {
        usedText   = r.text;
        violations = retryViolations;
      }
      usedTokensIn  += r.tokensIn;
      usedTokensOut += r.tokensOut;
      usedCostUsd   += r.costUsd;
      await logUsage({
        clerkId: cid, provider: usedProvider,
        model: usedProvider === 'anthropic' ? CLAUDE_MODEL : GEMINI_INSIGHT_MODEL,
        purpose: 'daily_insight',
        tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsdEst: r.costUsd,
        latencyMs: r.latencyMs, ok: true,
      });
    }
  }

  // 8. Persist. Race-safe: insertInsight returns null on unique-conflict, and
  //    if that happens we return the row that beat us.
  // The code constant wins over the DB flag. prompt_version exists so a bad
  // insight can be traced to the exact prompt text that produced it — a flag
  // that someone forgot to bump would record a version this run never used,
  // which is worse than no version at all. The flag stays available as an
  // override for deliberate A/B runs; it just can't silently lag the code.
  const flagVersion   = await flags.insightPromptVersion();
  const promptVersion = Math.max(flagVersion, DAILY_INSIGHT_PROMPT_VERSION);
  const contextSnapshot: Record<string, unknown> = {
    statistical_source:   statistical ? 'computed' : 'none',
    // Whether the note was written knowing who this trader says they are. Two
    // insights that read differently for the same numbers are explained by
    // this flag more often than by anything else in the snapshot.
    trader_profile_used:  traderProfile.length > 0,
    statistical_n:        statistical?.n ?? 0,
    trade_ids:            todayTrades.map(t => t.id),
    today_signals:        signals,
    // Trades written down after the last note, for other days. Kept in the
    // snapshot because a note that mentions a trade absent from `trade_ids` is
    // otherwise indistinguishable from one that invented it.
    late_logged_ids:      lateLogged.map(t => t.id),
    rules_broken:         rulesBroken,
    plan_execution:       planExecution,
    logging_habit:        loggingHabit,
    retrieval_query_text: retrieval.queryText,
    retrieval_skipped:    retrieval.skipped,
    retrieval_error:      retrieval.error ?? null,
    retrieval_top_score:  retrieval.topScore,
    budget_state:         budget.state,
    budget_user_spend:    budget.userSpendUsd,
    budget_user_cap:      budget.userCapUsd,
    // The behavioural state the insight was written from. Without it, an
    // insight that reads oddly can only be re-investigated against a history
    // that has since moved on — which is to say, not investigated at all.
    behavior_primary:     behavior.block.primary?.label ?? null,
    behavior_status:      behavior.block.primary?.status ?? null,
    behavior_insufficient: behavior.block.insufficientEvidence,
    behavior_snapshot:    behavior.snapshot,
    behavior_error:       behavior.error,
    // Output quality as a number rather than an impression. An empty array is
    // the claim being made every night; without it stored, a slow drift into
    // generic advice would be invisible until someone happened to read one.
    output_violations:    violations,
    output_retried:       retried,
  };

  const inserted = await insertInsight({
    clerkId:            cid,
    date:               inputs.date,
    kind,
    contentMd:          usedText.trim(),
    contentHash:        sha256Hex(usedText.trim()),
    model:              usedModel,
    promptVersion,
    fallbackUsed:       usedProvider === 'google',
    fallbackReason:     usedProvider === 'google' ? usedFallbackReason ?? 'api_error' : undefined,
    tokensIn:           usedTokensIn,
    tokensOut:          usedTokensOut,
    costUsdEst:         usedCostUsd,
    latencyMs:          usedLatency,
    retrievalChunkIds:  retrieval.chunkIds,
    retrievalTopScore:  retrieval.topScore ?? undefined,
    contextSnapshot,
  });

  if (!inserted) {
    // Race — another worker beat us. Return the winner's row.
    const winner = await getInsightForDate(cid, inputs.date, kind);
    if (winner) return { status: 'exists', row: winner };
    return { status: 'failed', reason: 'insert conflict but existing row not readable' };
  }

  return {
    status:         'ok',
    row:            inserted,
    provider:       usedProvider,
    fallbackReason: usedProvider === 'google' ? usedFallbackReason : undefined,
    primaryError,
  };
}

// ── Exports for tests ───────────────────────────────────────────────────────

export const __internals = { sha256Hex, checkBudget };

// Silence "TradeRow imported but only used as a type" complaints from linters
// that don't understand type-only imports pulled through this file (kept as a
// re-export so callers importing GenerateInputs get the whole ecosystem here).
export type { TradeRow };
