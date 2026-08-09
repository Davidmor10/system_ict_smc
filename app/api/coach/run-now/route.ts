// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coach/run-now — owner-only manual trigger for the daily insight.
//
// The nightly cron fires once a day at 01:00 UTC. That's the right cadence for
// production, but it makes "does this actually work?" a 24-hour question. This
// endpoint runs the exact same generateDailyInsight path for the calling user,
// right now, and returns a verbose result so a failure is readable instead of
// silent.
//
// Differences from the cron path — deliberate, and small:
//   - Skips the queue entirely (no processing_jobs row). We're not testing the
//     queue here, we're testing generation.
//   - `?force=1` deletes today's existing row first, so you can re-run and get
//     a fresh insight instead of the idempotent 'exists' short-circuit.
//
// Same budget checks, same fallback logic, same persistence as the cron. If it
// works here it works there.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { assertOwner } from '../../../lib/coach-pipeline/auth/guards';
import { isOwnerEmail } from '../../../lib/coach-pipeline/auth/owners';
import { generateDailyInsight, type PlanTier } from '../../../lib/coach-pipeline/pipelines/generateDailyInsight';
import { getClient } from '../../../lib/coach-pipeline/db/client';
import { T } from '../../../lib/coach-pipeline/types';
import { israelToday } from '../../../lib/coach-pipeline/dates';
import { normalizeRole } from '../../../lib/getUserRole';
import { listTradesForDate } from '../../../lib/coach-pipeline/db/trades';
import { getUserProfile } from '../../../lib/coach-pipeline/db/profile';
import { logger } from '../../../lib/logger';

const ROUTE = '/api/coach/run-now';

export const maxDuration = 60;
export const dynamic     = 'force-dynamic';

export async function GET(req: NextRequest) {
  // GET is deliberate here — the whole point is that you can hit this from a
  // browser address bar to see whether the pipeline works. It's owner-gated,
  // and the worst a cross-site trigger can do is generate one insight the
  // owner was going to get anyway.
  const gate = await assertOwner(ROUTE);
  if (gate instanceof NextResponse) return gate;
  const { userId } = gate;

  const started = Date.now();
  const date    = req.nextUrl.searchParams.get('date') ?? israelToday();
  const force   = req.nextUrl.searchParams.get('force') === '1';

  try {
    // Resolve the plan the same way the worker does.
    const { data: profileRow } = await getClient()
      .from('profiles')
      .select('role, email')
      .eq('clerk_id', userId)
      .maybeSingle();
    const planTier: PlanTier = isOwnerEmail(profileRow?.email)
      ? 'deluxe'
      : (normalizeRole(profileRow?.role) as PlanTier);

    // Pre-flight context, so a boring result ("no trades today") is obvious
    // from the response rather than needing a second round of digging.
    const [trades, profile] = await Promise.all([
      listTradesForDate(userId, date),
      getUserProfile(userId),
    ]);

    if (force) {
      await getClient()
        .from(T.dailyInsights)
        .delete()
        .eq('clerk_id', userId)
        .eq('date', date)
        .eq('kind', 'daily');
    }

    const result = await generateDailyInsight({ clerkId: userId, date, planTier, kind: 'daily' });

    return NextResponse.json({
      ranAt:     new Date().toISOString(),
      durationMs: Date.now() - started,
      input: {
        date,
        planTier,
        forced:            force,
        tradesFoundToday:  trades.length,
        hasRollingProfile: !!profile,
      },
      result,
      // Plain-language read of what happened, so the next step is obvious.
      interpretation: interpret(result.status, planTier, trades.length),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('run-now failed', { userId, error: msg });
    return NextResponse.json({ ok: false, error: msg, durationMs: Date.now() - started }, { status: 500 });
  }
}

function interpret(status: string, plan: PlanTier, tradeCount: number): string {
  switch (status) {
    case 'ok':
      return 'Insight generated and saved. Refresh the dashboard to see it.';
    case 'exists':
      return "An insight already exists for this date — returned the stored one. Add ?force=1 to regenerate.";
    case 'ineligible':
      return `Plan tier is "${plan}" — the free tier does not receive insights. Set role to starter/pro/deluxe in the profiles table.`;
    case 'disabled':
      return 'ai_pipeline_enabled is false in feature_flags. Set it back to true.';
    case 'failed':
      return 'Generation failed — see result.reason. Usually a missing/invalid ANTHROPIC_API_KEY.';
    case 'both_providers_down':
      return 'Both Claude and Gemini failed — see result.claudeError / result.geminiError. Check both API keys.';
    default:
      return `Unrecognized status "${status}" with ${tradeCount} trades today.`;
  }
}
