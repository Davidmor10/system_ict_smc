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
//
// TWO WAYS IN
//   1. Signed in as the owner (Clerk session). The normal path.
//   2. `?key=<CRON_SECRET>&clerk_id=<id>` — the same shared secret the cron
//      authenticates with. This exists because path 1 depends on the browser
//      sending a Clerk session cookie, which silently fails whenever the URL
//      is on a different host than the one you logged in on (a Vercel preview
//      URL, say). Debugging "the pipeline is broken" should not first require
//      debugging which hostname your cookie lives on.
//
// The tradeoff of path 2 is real: a secret in a query string lands in browser
// history and the platform's access logs. It is here because this endpoint
// spends about one cent and writes one row that ?force=1 can overwrite — the
// blast radius does not justify a token-exchange flow. If you use it, rotate
// CRON_SECRET afterwards and the exposure ends with it.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { assertOwner, safeEqual } from '../../../lib/coach-pipeline/auth/guards';
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

/** Resolve who this run is for, by either accepted credential.
 *
 *  The secret is compared in constant time and only after confirming it is
 *  configured at all — an unset CRON_SECRET must never make `key=undefined`
 *  or an empty string a valid credential. */
function authorizeByKey(req: NextRequest): { userId: string } | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;

  const key = req.nextUrl.searchParams.get('key');
  if (!key || !safeEqual(key, secret)) return null;

  // The key proves "you are the operator", not "you are user X" — so the
  // target user has to be named explicitly. No default: silently running for
  // the wrong account is worse than an error message.
  const clerkId = req.nextUrl.searchParams.get('clerk_id');
  if (!clerkId) return null;

  return { userId: clerkId };
}

export async function GET(req: NextRequest) {
  // GET is deliberate here — the whole point is that you can hit this from a
  // browser address bar to see whether the pipeline works. It's owner-gated,
  // and the worst a cross-site trigger can do is generate one insight the
  // owner was going to get anyway.
  const viaKey = authorizeByKey(req);
  let userId: string;
  if (viaKey) {
    logger.warn('run-now authorized by shared secret, not a session', {
      route: ROUTE, userId: viaKey.userId,
    });
    userId = viaKey.userId;
  } else {
    const gate = await assertOwner(ROUTE);
    if (gate instanceof NextResponse) return gate;
    userId = gate.userId;
  }

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
