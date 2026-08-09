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

import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { assertOwner, safeEqual, cronSecret } from '../../../lib/coach-pipeline/auth/guards';
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
 *  Returns `{ skip: true }` when no key was supplied at all — that's the
 *  ordinary session path, not a failure. When a key WAS supplied but didn't
 *  work, it says which of the three reasons applied.
 *
 *  Being specific matters here. The first version fell through to the Clerk
 *  check on every failure, so a wrong key, an unset CRON_SECRET, a missing
 *  clerk_id and a plain unauthenticated browser all produced the identical
 *  `401 Unauthorized` — and this endpoint exists precisely so that failures
 *  are readable. It leaks nothing: whoever sent a key already knows whether
 *  they sent one.
 *
 *  The secret is compared in constant time, and only after confirming it is
 *  configured at all — an unset CRON_SECRET must never make `key=` or an
 *  empty string into a valid credential. */
/** Which build is actually serving this request.
 *
 *  Vercel bakes environment variables into a deployment at build time, so a
 *  variable you changed after the last build is not the variable the running
 *  function sees. That has cost this project several rounds of "but I set
 *  it" — the commit and the build time make it checkable instead of
 *  arguable. All three values are already public in the repo or the
 *  deployment list. */
function deploymentInfo() {
  return {
    commit:  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'unknown',
    env:     process.env.VERCEL_ENV ?? 'local',
    builtAt: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  };
}

/** First 8 hex of SHA-256. Lets two values be compared for equality without
 *  either being disclosed: 32 bits of a hash over a 256-bit random secret is
 *  not something you work backwards from, but it answers "is the deployment
 *  holding the string I think it is?" in one glance. */
function fingerprint(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 8);
}

type KeyAuth =
  | { ok: true;  userId: string }
  | { ok: false; skip: true }
  | {
      ok: false; skip: false; reason: string;
      lengths?:     { received: number; expected: number };
      fingerprints?: { received: string; configured: string };
    };

function authorizeByKey(req: NextRequest): KeyAuth {
  const key = req.nextUrl.searchParams.get('key')?.trim();
  if (!key) return { ok: false, skip: true };

  const secret = cronSecret();
  if (!secret) {
    return { ok: false, skip: false, reason: 'CRON_SECRET is not set on this deployment' };
  }
  if (!safeEqual(key, secret)) {
    // Lengths, not content. A mismatch is nearly always truncation (a copy
    // that missed the tail) or mangling (`+` decoded as a space, `%` eaten as
    // an escape) — both of which show up here instantly, and neither of which
    // is findable by staring at two long hex strings. Publishing the length
    // of a high-entropy secret to someone already holding a candidate for it
    // costs nothing they could use.
    return {
      ok: false, skip: false,
      reason: 'key does not match CRON_SECRET',
      lengths:      { received: key.length,      expected:   secret.length },
      fingerprints: { received: fingerprint(key), configured: fingerprint(secret) },
    };
  }

  // The key proves "you are the operator", not "you are user X" — so the
  // target user has to be named explicitly. No default: silently running for
  // the wrong account is worse than an error message.
  const clerkId = req.nextUrl.searchParams.get('clerk_id');
  if (!clerkId) {
    return { ok: false, skip: false, reason: 'key accepted, but clerk_id is missing' };
  }

  return { ok: true, userId: clerkId };
}

export async function GET(req: NextRequest) {
  // GET is deliberate here — the whole point is that you can hit this from a
  // browser address bar to see whether the pipeline works. It's owner-gated,
  // and the worst a cross-site trigger can do is generate one insight the
  // owner was going to get anyway.
  const viaKey = authorizeByKey(req);

  let userId: string;
  if (viaKey.ok) {
    logger.warn('run-now authorized by shared secret, not a session', {
      route: ROUTE, userId: viaKey.userId,
    });
    userId = viaKey.userId;
  } else if (!viaKey.skip) {
    // A key was offered and rejected. Say why rather than falling back to the
    // session check, which would report the wrong problem.
    return NextResponse.json(
      {
        error:        'Unauthorized',
        via:          'key',
        reason:       viaKey.reason,
        lengths:      viaKey.lengths,
        fingerprints: viaKey.fingerprints,
        deployment:   deploymentInfo(),
      },
      { status: 401 },
    );
  } else {
    const gate = await assertOwner(ROUTE);
    if (gate instanceof NextResponse) {
      // Same idea for the session path: 401 here means Clerk saw no session
      // (usually a cookie scoped to a different hostname), 403 means signed in
      // but not an owner. Naming which one saves a round of guessing.
      const status = gate.status;
      return NextResponse.json(
        {
          error:  status === 403 ? 'Forbidden' : 'Unauthorized',
          via:    'session',
          reason: status === 403
            ? 'signed in, but this email is not in the owner allowlist'
            : 'no Clerk session on this request — check you are signed in on this exact hostname, or use ?key=&clerk_id=',
        },
        { status },
      );
    }
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
      ranAt:      new Date().toISOString(),
      durationMs: Date.now() - started,
      deployment: deploymentInfo(),
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
