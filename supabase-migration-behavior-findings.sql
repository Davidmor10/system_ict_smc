-- ─────────────────────────────────────────────────────────────────────────────
-- behavior_findings + behavior_finding_events
--
-- WHY
--
-- The behaviour layer recomputes everything from trades on every run, which is
-- what keeps it honest — a corrected trade changes the conclusion instead of
-- being frozen into a record nobody can revise. It is also what makes it
-- amnesiac, and four things cannot be recomputed:
--
--   when the behaviour was first seen  — "three weeks" is a different sentence
--                                        to "6 of 15"
--   the experiment                     — an instruction, a window, and the
--                                        numbers AS THEY STOOD when it opened.
--                                        Without that snapshot an experiment
--                                        can be started but never judged
--   the question and its answer        — asked once, not re-asked every
--                                        morning; and when answered, the only
--                                        evidence in the system that isn't
--                                        trade telemetry
--   the relapse count                  — a behaviour that came back is not a
--                                        behaviour discovered
--
-- The counts and rates stored here are a SNAPSHOT for display and for noticing
-- movement. They are never read back as an input — the next run recomputes
-- them from the trades.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. behavior_findings — one live row per (trader, behaviour)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists behavior_findings (
  clerk_id              text        not null,
  kind                  text        not null,
  id                    uuid        primary key default gen_random_uuid(),

  status                text        not null default 'detected',
  first_detected_at     timestamptz not null default now(),
  status_since          timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),

  -- Snapshot of the last run. Display only — see the header.
  occurrences           integer     not null default 0,
  opportunities         integer     not null default 0,
  rate                  numeric     not null default 0,
  baselines             jsonb,
  confidence            text        not null default 'unknown',

  -- Asked once. NULL answer means still open, and an open question is not
  -- evidence — only an answered one counts as a second source.
  question              text,
  question_asked_at     timestamptz,
  trader_answer         text,
  trader_answered_at    timestamptz,

  -- The experiment, and the world as it stood when the window opened.
  experiment            jsonb,
  experiment_started_at timestamptz,
  experiment_baseline   jsonb,
  experiment_result     jsonb,

  relapses              integer     not null default 0,

  is_primary            boolean     not null default false,
  primary_since         timestamptz,

  updated_at            timestamptz not null default now(),

  -- The lifecycle, enforced. A typo'd status would otherwise sit in the table
  -- looking like a state the code simply hasn't implemented yet.
  constraint behavior_findings_status_check check (status in (
    'detected','investigating','confirmed','experiment',
    'monitoring','improved','resolved','archived'
  )),
  constraint behavior_findings_confidence_check check (confidence in (
    'high','medium','low','unknown'
  ))
);

-- One live finding per behaviour per trader. This is the conflict target the
-- upsert names; without it a nightly run would append a second row every night
-- and the "first detected" date would reset every time.
create unique index if not exists behavior_findings_clerk_kind
  on behavior_findings (clerk_id, kind);

create index if not exists behavior_findings_primary
  on behavior_findings (clerk_id, is_primary)
  where is_primary;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. behavior_finding_events — append-only lifecycle timeline
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The findings table holds the present tense. This holds how it got there.
--
-- It is not an audit log for its own sake: the product's central claim is that
-- a behaviour changed, and a claim of change with no record of the states it
-- passed through is unfalsifiable. When the system says "this improved", this
-- table is where that sentence can be checked.
create table if not exists behavior_finding_events (
  id            uuid        primary key default gen_random_uuid(),
  clerk_id      text        not null,
  finding_id    uuid        not null references behavior_findings(id) on delete cascade,
  kind          text        not null,
  at            timestamptz not null default now(),
  from_status   text,
  to_status     text        not null,
  reason        text        not null default '',
  -- Counts, rates and any measurement at the moment of the transition, so the
  -- timeline can be read without re-deriving the past.
  snapshot      jsonb
);

create index if not exists behavior_finding_events_clerk
  on behavior_finding_events (clerk_id, at desc);
create index if not exists behavior_finding_events_finding
  on behavior_finding_events (finding_id, at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Lock down. Both tables are reached only through the service role, the
--    same as every other intelligence table — no anon/authenticated grants.
-- ═══════════════════════════════════════════════════════════════════════════
alter table behavior_findings       enable row level security;
alter table behavior_finding_events enable row level security;

revoke all on behavior_findings       from anon, authenticated;
revoke all on behavior_finding_events from anon, authenticated;

-- Verify.
select
  (select count(*) from behavior_findings)       as findings,
  (select count(*) from behavior_finding_events) as events;
