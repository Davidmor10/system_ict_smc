// ─────────────────────────────────────────────────────────────────────────────
// Coach pipeline — TypeScript row shapes for the 11 tables added in
// supabase-migration-intelligence.sql. One type per table, using the field
// names verbatim so a query result parses straight into the type. jsonb
// columns get narrower types where the shape is fixed (e.g. Statistical),
// and stay `unknown` where the app allows free content.
// ─────────────────────────────────────────────────────────────────────────────

// ── Enums (mirror the CHECK constraints in SQL) ─────────────────────────────
export type TradeResult      = 'OPEN' | 'WIN' | 'LOSS' | 'BE';
export type TradeDirection   = 'LONG' | 'SHORT';
export type NotebookKind     = 'journal' | 'plan' | 'note';
export type InsightKind      = 'daily'   | 'session';
export type UserReaction     = 'helpful' | 'meh' | 'not_helpful';
export type JobType          = 'profile_refresh' | 'note_embed' | 'daily_insight' | 'session_insight';
export type JobStatus        = 'pending' | 'running' | 'success' | 'failed' | 'dead_letter';
export type JobErrorKind     = 'timeout' | 'rate_limit' | 'model_error' | 'exhausted';
export type Provider         = 'anthropic' | 'google';
export type FallbackReason   = 'budget_cap' | 'rate_limit' | 'timeout' | 'api_error' | 'system_budget_alarm';

// ── 1. intelligence_trades ──────────────────────────────────────────────────
export interface TradeRow {
  clerk_id:               string;
  id:                     string;
  created_at:             string;
  updated_at:             string;
  deleted_at:             string | null;

  date:                   string;
  time:                   string | null;
  symbol:                 string;
  direction:              string;                     // narrowed on write; free on read
  contracts:              number;
  entry_price:            number;
  stop_loss:              number;
  take_profit:            number | null;
  exit_price:             number | null;
  exits:                  Array<{ price: number; contracts: number }> | null;

  rr_planned:             number | null;
  r_multiple:             number | null;
  pnl_usd:                number | null;
  result:                 string;

  session:                string | null;
  bias:                   string | null;
  setup:                  string | null;
  confirmations:          string[] | null;
  emotional_state:        string | null;
  /** The trader's own verdict, or null when they didn't answer. Null is not
   *  compliance — see detectRuleViolation. */
  followed_rules:         boolean | null;
  /** 'none' | 'advanced' | 'widened', or null when the trader didn't answer.
   *  Null is not "didn't move it" — see detectStopWidened. */
  stop_moved:             string | null;
  /** Optional: a database that has not run
   *  supabase-migration-intelligence-stop-note.sql simply does not return it,
   *  and a note without the sentence is still a note. */
  stop_note?:             string | null;
  /** Management events with timestamps. When present they OVERRIDE
   *  stop_moved — a record beats a recollection. */
  management:             Array<{ at: string; kind: string; to: number; contracts?: number; note?: string }> | null;
  notes:                  string;
  tags:                   string[];
  screenshots:            string[] | null;

  profile_processed_at:   string | null;
  profile_processed_rev:  number;
}

// ── 2. notebook_entries ─────────────────────────────────────────────────────
export interface NotebookEntryRow {
  clerk_id:               string;
  id:                     string;
  created_at:             string;
  updated_at:             string;
  deleted_at:             string | null;

  kind:                   NotebookKind;
  title:                  string;
  body:                   string;
  body_hash:              string;                     // sha256 hex

  mood:                   number | null;              // 1..5
  tags:                   string[];
  linked_trade_id:        string | null;

  profile_processed_at:   string | null;
  profile_processed_rev:  number;
  embedded_at:            string | null;
  embedded_body_hash:     string | null;
}

// ── 3. notebook_chunks ──────────────────────────────────────────────────────
export interface NotebookChunkRow {
  clerk_id:               string;
  id:                     string;
  entry_id:               string;
  chunk_ix:               number;
  content:                string;
  token_count:            number;
  embedding:              number[];                    // 768-dim
  created_at:             string;
}

/** Retrieval hit — chunk row + its cosine similarity score to the query. */
export interface ChunkHit extends NotebookChunkRow {
  score: number;
}

// ── 4. user_profile ─────────────────────────────────────────────────────────
export interface Statistical {
  n?:            number;
  wr?:           number;
  avg_r?:        number;
  pf?:           number;
  exp_usd?:      number;
  max_dd_usd?:   number;
  streak_now?:   number;
  by_session?:   Record<string, { n: number; wr: number; r: number }>;
  by_setup?:     Record<string, { n: number; wr: number; r: number }>;
  by_symbol?:    Record<string, { n: number; wr: number; r: number }>;
  last_7d?:      { n: number; wr: number; r: number; trend: 'up' | 'down' | 'flat' };
}

// The rolling profile that was designed here and never built.
//
// `Behavioral` and `UserProfileRow` described a user_profile row written by a
// background agent: extracted patterns, a discipline score, a narrative bio.
// Nothing in the app ever wrote one — the writer had no caller outside its own
// tests — so the daily insight's <user_profile> block shipped those two fields
// empty every night under a contract that said they were filled.
//
// Both were built for real elsewhere in the meantime: the behaviour layer owns
// recurring mistakes, discipline and strengths and hands them over in its own
// block, and the trader's own words reach the prompt as
// <trader_self_description>. Keeping a second, empty home for the same claims
// is what the two-stack rule in docs/ai-architecture.md exists to prevent, so
// the types went with the reader. `Statistical` above stays — it is computed
// from the journal on every run and is the whole of what that block now sends.

// ── 5. processing_jobs ──────────────────────────────────────────────────────
export interface ProcessingJobRow {
  id:                    string;
  clerk_id:              string;
  job_type:              JobType;
  status:                JobStatus;
  target_date:           string | null;
  scheduled_at:          string | null;
  started_at:            string | null;
  finished_at:           string | null;
  attempt_count:         number;
  next_retry_at:         string | null;
  input_trade_ids:       string[] | null;
  input_entry_ids:       string[] | null;
  output_summary:        Record<string, unknown> | null;
  tokens_used:           number | null;
  error:                 string | null;
  error_kind:            JobErrorKind | null;
}

// ── 6. ai_usage_log ─────────────────────────────────────────────────────────
export interface AiUsageRow {
  id:                    string;
  clerk_id:              string | null;
  created_at:            string;
  provider:              Provider;
  model:                 string;
  purpose:               string;
  tokens_in:             number;
  tokens_out:            number;
  cost_usd_estimate:     number;
  latency_ms:            number | null;
  ok:                    boolean;
  error_kind:            string | null;
}

// ── 7. rate_limits ──────────────────────────────────────────────────────────
export interface RateLimitRow {
  clerk_id:              string;
  purpose:               string;
  window_start:          string;
  tokens_consumed:       number;
  requests_count:        number;
}

// ── 8. daily_insights ───────────────────────────────────────────────────────
export interface DailyInsightRow {
  clerk_id:              string;
  id:                    string;
  date:                  string;
  kind:                  InsightKind;
  generated_at:          string;

  content_md:            string;
  content_hash:          string;

  model:                 string;
  prompt_version:        number;
  fallback_used:         boolean;
  fallback_reason:       FallbackReason | null;
  tokens_in:             number;
  tokens_out:            number;
  cost_usd_estimate:     number;
  latency_ms:            number | null;

  retrieval_chunk_ids:   string[];
  retrieval_top_score:   number | null;
  context_snapshot:      Record<string, unknown>;

  read_at:               string | null;
  user_reaction:         UserReaction | null;
  reaction_at:           string | null;
}

// ── 9. feature_flags ────────────────────────────────────────────────────────
export interface FeatureFlagRow {
  key:                   string;
  value_json:            unknown;
  updated_at:            string;
  updated_by:            string | null;
}

/** Every seeded flag key. Keeping the list here means TS catches a typo the
    moment you `getFlag('typo_key')` — key validated at compile time, value at
    runtime. */
export type FeatureFlagKey =
  | 'ai_pipeline_enabled'
  | 'daily_budget_alarm_usd'
  | 'user_monthly_cap_starter_usd'
  | 'user_monthly_cap_pro_usd'
  | 'user_monthly_cap_deluxe_usd'
  | 'provider_rate_limiter_enabled'
  | 'insight_prompt_version'
  | 'analyzer_version'
  | 'idle_skip_days'
  | 'spread_window_minutes'
  | 'worker_concurrency'
  | 'worker_retry_max';

// ── 10. ai_provider_state ───────────────────────────────────────────────────
export interface AiProviderStateRow {
  provider:              Provider;
  rpm_limit:             number;
  window_start:          string;
  window_count:          number;
  is_backed_off_until:   string | null;
}

// ── 11. cron_runs ───────────────────────────────────────────────────────────
export type CronKey = 'nightly-orchestrate' | 'process-jobs';

export interface CronRunRow {
  id:                    number;
  cron_key:              CronKey;
  started_at:            string;
  finished_at:           string | null;
  duration_ms:           number | null;
  jobs_picked:           number;
  jobs_completed:        number;
  jobs_failed:           number;
  jobs_retried:          number;
  error:                 string | null;
  /** What the mirror reconciliation found and repaired. Null on rows written
   *  before the reconciler existed, or by a database that has not run
   *  supabase-migration-cron-reconcile.sql — which is a different fact from
   *  zero, and the health surface says so. */
  repaired_missing?:     number | null;
  repaired_ghosts?:      number | null;
  orphans?:              number | null;
}

// ── Table names — single source of truth for the DB layer ───────────────────
export const T = {
  trades:            'intelligence_trades',
  notebookEntries:   'notebook_entries',
  notebookChunks:    'notebook_chunks',
  processingJobs:    'processing_jobs',
  aiUsageLog:        'ai_usage_log',
  rateLimits:        'rate_limits',
  dailyInsights:     'daily_insights',
  featureFlags:      'feature_flags',
  aiProviderState:   'ai_provider_state',
  cronRuns:          'cron_runs',
  behaviorFindings:  'behavior_findings',
  behaviorEvents:    'behavior_finding_events',
} as const;
