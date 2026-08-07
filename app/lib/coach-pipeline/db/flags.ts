// ─────────────────────────────────────────────────────────────────────────────
// feature_flags — kill switches + tunable thresholds. Read-heavy, so we cache
// in memory per warm serverless instance (60 s TTL). Writes bust the cache
// locally; other instances see stale values for up to 60 s (acceptable for
// what these flags do).
// ─────────────────────────────────────────────────────────────────────────────

import { T, type FeatureFlagKey, type FeatureFlagRow } from '../types';
import { getClient } from './client';

const CACHE_TTL_MS = 60_000;

let cache:  Map<string, unknown> | null = null;
let cachedAt = 0;

async function refresh(): Promise<Map<string, unknown>> {
  const { data, error } = await getClient()
    .from(T.featureFlags)
    .select('key, value_json');
  if (error) throw error;
  const map = new Map<string, unknown>();
  for (const row of (data ?? []) as Pick<FeatureFlagRow, 'key' | 'value_json'>[]) {
    map.set(row.key, row.value_json);
  }
  cache    = map;
  cachedAt = Date.now();
  return map;
}

async function loadAll(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  return refresh();
}

/** Read a single flag by its typed key. If the flag doesn't exist in DB
    (someone deleted the seed, migration hasn't run yet, whatever) — returns
    the caller's `fallback`. This keeps the pipeline running under partial
    misconfiguration rather than crashing. */
export async function getFlag<T>(key: FeatureFlagKey, fallback: T): Promise<T> {
  const all = await loadAll();
  const val = all.get(key);
  return (val === undefined ? fallback : (val as T));
}

/** Typed helpers — one per known flag. These are the ONLY read paths the rest
    of the pipeline should use, so all defaults live in one place. */

export const flags = {
  aiPipelineEnabled:          () => getFlag<boolean>('ai_pipeline_enabled',              true),
  dailyBudgetAlarmUsd:        () => getFlag<number>('daily_budget_alarm_usd',            5),
  userMonthlyCapStarterUsd:   () => getFlag<number>('user_monthly_cap_starter_usd',      1),
  userMonthlyCapProUsd:       () => getFlag<number>('user_monthly_cap_pro_usd',          3),
  userMonthlyCapDeluxeUsd:    () => getFlag<number>('user_monthly_cap_deluxe_usd',       10),
  providerRateLimiterEnabled: () => getFlag<boolean>('provider_rate_limiter_enabled',    false),
  insightPromptVersion:       () => getFlag<number>('insight_prompt_version',            1),
  analyzerVersion:            () => getFlag<number>('analyzer_version',                  1),
  idleSkipDays:               () => getFlag<number>('idle_skip_days',                    30),
  spreadWindowMinutes:        () => getFlag<number>('spread_window_minutes',             60),
  workerConcurrency:          () => getFlag<number>('worker_concurrency',                5),
  workerRetryMax:             () => getFlag<number>('worker_retry_max',                  3),
};

/** Update one flag (admin only — no plans yet for a UI, but the RPC route
    when it exists will use this). Busts the local cache so the calling
    request sees the fresh value immediately. */
export async function setFlag(
  key: FeatureFlagKey,
  value: unknown,
  updatedBy?: string,
): Promise<void> {
  const { error } = await getClient()
    .from(T.featureFlags)
    .upsert(
      { key, value_json: value, updated_by: updatedBy ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
  if (error) throw error;
  cache = null;
  cachedAt = 0;
}

/** For tests: reset the memo. */
export function __resetFlagCacheForTests(): void {
  cache = null;
  cachedAt = 0;
}
