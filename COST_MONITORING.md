# AI Cost Monitoring

Every AI call the pipeline makes writes one row to `ai_usage_log` — success or
failure, no exceptions. That table is the single source of truth for spend.

## The fast way — one URL

```
https://systemictsmc.vercel.app/api/coach/usage-summary
```

Owner-only (gated to the owner emails). Returns JSON:

```json
{
  "month": {
    "calls": 31,
    "failedCalls": 0,
    "tokensIn": 118400,
    "tokensOut": 12900,
    "costUsd": 0.5487,
    "projectedMonthUsd": 0.6812
  },
  "today":     { "calls": 1, "costUsd": 0.0193 },
  "byPurpose": { "daily_insight": {...}, "note_embed": {...}, "retrieval_query": {...} },
  "byModel":   { "anthropic/claude-3-5-sonnet-20241022": {...}, "google/text-embedding-004": {...} },
  "topUsers":  { "user_abc...": {...} }
}
```

`projectedMonthUsd` is a straight-line projection: spend-so-far ÷ days-elapsed ×
days-in-month. Rough but honest.

## The precise way — SQL in Supabase

### This month's total
```sql
select
  round(sum(cost_usd_estimate)::numeric, 4) as cost_usd,
  count(*)                                   as calls,
  sum(tokens_in)                             as tokens_in,
  sum(tokens_out)                            as tokens_out
from ai_usage_log
where created_at >= date_trunc('month', now());
```

### Broken down by what it was spent on
```sql
select
  purpose,
  provider,
  model,
  count(*)                                   as calls,
  round(sum(cost_usd_estimate)::numeric, 4)  as cost_usd
from ai_usage_log
where created_at >= date_trunc('month', now())
group by purpose, provider, model
order by cost_usd desc;
```

### Cost per user this month (who is expensive?)
```sql
select
  clerk_id,
  count(*)                                   as calls,
  round(sum(cost_usd_estimate)::numeric, 4)  as cost_usd
from ai_usage_log
where created_at >= date_trunc('month', now())
  and clerk_id is not null
group by clerk_id
order by cost_usd desc
limit 20;
```

### Daily trend (last 30 days)
```sql
select
  created_at::date                           as day,
  count(*)                                   as calls,
  round(sum(cost_usd_estimate)::numeric, 4)  as cost_usd
from ai_usage_log
where created_at >= now() - interval '30 days'
group by day
order by day desc;
```

### Failures (are we burning calls that produce nothing?)
```sql
select
  error_kind,
  provider,
  count(*) as failures
from ai_usage_log
where ok = false
  and created_at >= now() - interval '7 days'
group by error_kind, provider
order by failures desc;
```

## What each call actually costs

| Purpose | Provider / model | Price | Typical per call |
|---|---|---|---|
| `daily_insight` | Anthropic Sonnet 3.5 | $3/M in · $15/M out | **~$0.019** (≈4k in, 400 out) |
| `daily_insight` (fallback) | Gemini 2.5 Flash | $0.075/M in · $0.30/M out | **~$0.0004** |
| `note_embed` | Google text-embedding-004 | free tier | **$0** |
| `retrieval_query` | Google text-embedding-004 | free tier | **$0** |

### Realistic monthly bill

| Active paying users | Insights/month | Est. cost |
|---|---|---|
| 1 (just you) | ~30 | **$0.60** |
| 10 | ~250 | **$4.75** |
| 50 | ~1,100 | **$21** |
| 200 | ~4,400 | **$84** |

Starter tier only runs Sun/Tue/Thu, so it's ~43% of a daily user's cost.

## The guardrails that stop a surprise bill

All live in the `feature_flags` table — change a value, no redeploy needed.

| Flag | Default | What it does |
|---|---|---|
| `ai_pipeline_enabled` | `true` | **Kill switch.** Set to `false` and every AI call stops within 60s. |
| `daily_budget_alarm_usd` | `5` | System-wide daily ceiling. Above it, everyone falls back to Gemini. |
| `user_monthly_cap_starter_usd` | `1` | Per-user monthly cap → Gemini fallback above it |
| `user_monthly_cap_pro_usd` | `3` | Same, Pro tier |
| `user_monthly_cap_deluxe_usd` | `10` | Same, Deluxe tier |

### Emergency stop
```sql
update feature_flags set value_json = 'false'::jsonb where key = 'ai_pipeline_enabled';
```
Takes effect within 60 seconds (flag cache TTL). Reverse with `'true'::jsonb`.

### Tighten a cap
```sql
update feature_flags set value_json = '2'::jsonb where key = 'user_monthly_cap_pro_usd';
```

## Also check the provider consoles

The ledger is our own accounting. The authoritative bill lives at:

- **Anthropic** — https://console.anthropic.com/settings/usage
- **Google AI** — https://aistudio.google.com/app/usage (embeddings should read $0)

If `ai_usage_log` and the Anthropic console disagree by more than a few percent,
something is calling the API outside the pipeline — worth investigating.
