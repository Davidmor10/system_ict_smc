// ─────────────────────────────────────────────────────────────────────────────
// In-memory sliding-window rate limiter.
//
// Good enough for a single Vercel serverless instance handling one user's
// own requests (the AI routes and checkout are auth-gated, so this is about
// throttling a compromised/scripted client, not stopping a distributed
// attack). It resets on cold start and doesn't share state across instances —
// if the app ever needs real multi-instance guarantees, swap this for an
// Upstash/Redis-backed limiter without changing the call sites below.
// ─────────────────────────────────────────────────────────────────────────────

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  /** Seconds the caller should wait before retrying, only set when ok is false. */
  retryAfterSec?: number;
}

/**
 * Sliding-window limit: at most `limit` calls per `windowMs` for a given key
 * (e.g. `ai:discovery:${userId}`). Prunes old timestamps on each call so the
 * map never grows unbounded per key, and periodically sweeps stale keys.
 */
export function checkRateLimit(key: string, limit = 20, windowMs = 60_000): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter(t => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0];
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    buckets.set(key, bucket);
    return { ok: false, retryAfterSec };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);

  // Occasional cleanup so long-lived instances don't accumulate dead keys.
  if (buckets.size > 5000 && Math.random() < 0.01) {
    for (const [k, b] of buckets) {
      if (b.timestamps.every(t => now - t >= windowMs)) buckets.delete(k);
    }
  }

  return { ok: true };
}
