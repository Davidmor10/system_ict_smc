// ─────────────────────────────────────────────────────────────────────────────
// behavior_findings access. clerk_id-scoped by construction, like every other
// module in db/ — no query here can reach another trader's rows.
//
// Deliberately thin. Every decision about what a finding becomes lives in
// behavior/memory.ts, which is pure and therefore testable without a database;
// this file only moves the result in and out and translates between snake_case
// columns and the camelCase record.
// ─────────────────────────────────────────────────────────────────────────────

import { T } from '../types';
import { getClient, requireClerkId } from './client';
import type { BehaviorKind } from '../behavior/behaviors';
import type { StoredFinding, Transition, ExperimentBaseline } from '../behavior/memory';
import type { Baselines, FindingStatus } from '../behavior/finding';
import type { Confidence } from '../behavior/evidence';
import type { Experiment, ExperimentResult } from '../behavior/experiment';
import { logger } from '../../logger';

interface Row {
  id:                    string;
  clerk_id:              string;
  kind:                  string;
  status:                string;
  first_detected_at:     string;
  status_since:          string;
  last_seen_at:          string;
  occurrences:           number;
  opportunities:         number;
  rate:                  number;
  baselines:             Baselines | null;
  confidence:            string;
  question:              string | null;
  question_asked_at:     string | null;
  trader_answer:         string | null;
  trader_answered_at:    string | null;
  experiment:            Experiment | null;
  experiment_started_at: string | null;
  experiment_baseline:   ExperimentBaseline | null;
  experiment_result:     ExperimentResult | null;
  relapses:              number;
  is_primary:            boolean;
  primary_since:         string | null;
}

const ZERO_BASELINES: Baselines = { historicalRate: 0, historicalN: 0, rollingRate: 0, rollingN: 0 };

export function rowToStored(row: Row): StoredFinding {
  return {
    kind:   row.kind as BehaviorKind,
    status: row.status as FindingStatus,
    firstDetectedAt: row.first_detected_at,
    statusSince:     row.status_since,
    lastSeenAt:      row.last_seen_at,
    occurrences:   row.occurrences,
    opportunities: row.opportunities,
    rate:          Number(row.rate),
    baselines:     row.baselines ?? ZERO_BASELINES,
    confidence:    row.confidence as Confidence,
    question:         row.question,
    questionAskedAt:  row.question_asked_at,
    traderAnswer:     row.trader_answer,
    traderAnsweredAt: row.trader_answered_at,
    experiment:          row.experiment,
    experimentStartedAt: row.experiment_started_at,
    experimentBaseline:  row.experiment_baseline,
    experimentResult:    row.experiment_result,
    relapses:     row.relapses,
    isPrimary:    row.is_primary,
    primarySince: row.primary_since,
  };
}

export function storedToRow(clerkId: string, f: StoredFinding) {
  return {
    clerk_id: clerkId,
    kind:     f.kind,
    status:   f.status,
    first_detected_at: f.firstDetectedAt,
    status_since:      f.statusSince,
    last_seen_at:      f.lastSeenAt,
    occurrences:   f.occurrences,
    opportunities: f.opportunities,
    rate:          f.rate,
    baselines:     f.baselines,
    confidence:    f.confidence,
    question:           f.question,
    question_asked_at:  f.questionAskedAt,
    trader_answer:      f.traderAnswer,
    trader_answered_at: f.traderAnsweredAt,
    experiment:            f.experiment,
    experiment_started_at: f.experimentStartedAt,
    experiment_baseline:   f.experimentBaseline,
    experiment_result:     f.experimentResult,
    relapses:      f.relapses,
    is_primary:    f.isPrimary,
    primary_since: f.primarySince,
    updated_at:    new Date().toISOString(),
  };
}

/** Every stored finding for this trader, keyed by behaviour. */
export async function loadFindings(clerkId: string): Promise<Map<BehaviorKind, StoredFinding>> {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient()
    .from(T.behaviorFindings)
    .select('*')
    .eq('clerk_id', cid);
  if (error) throw error;
  const out = new Map<BehaviorKind, StoredFinding>();
  for (const row of (data ?? []) as Row[]) out.set(row.kind as BehaviorKind, rowToStored(row));
  return out;
}

/** Persist one reconciled finding, and its transition if it moved.
 *
 *  The upsert names (clerk_id, kind) so a nightly run updates the existing row
 *  rather than appending a second one — which would reset "first detected" to
 *  today, every day, and quietly destroy the only number that can say how long
 *  this has been going on. */
export async function saveFinding(
  clerkId: string,
  finding: StoredFinding,
  transition: Transition | null,
): Promise<void> {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient()
    .from(T.behaviorFindings)
    .upsert(storedToRow(cid, finding), { onConflict: 'clerk_id,kind' })
    .select('id')
    .single();
  if (error) throw error;

  if (!transition) return;
  const { error: evErr } = await getClient()
    .from(T.behaviorEvents)
    .insert({
      clerk_id:    cid,
      finding_id:  (data as { id: string }).id,
      kind:        finding.kind,
      at:          finding.statusSince,
      from_status: transition.from,
      to_status:   transition.to,
      reason:      transition.reason,
      snapshot: {
        occurrences:   finding.occurrences,
        opportunities: finding.opportunities,
        rate:          finding.rate,
        baselines:     finding.baselines,
        confidence:    finding.confidence,
        experimentResult: finding.experimentResult,
      },
    });
  // The timeline is evidence, not state. Losing an event must not lose the
  // finding that was already written above.
  if (evErr) logger.warn('behavior event insert failed', { clerkId: cid, kind: finding.kind, error: evErr.message });
}

/** The lifecycle timeline, newest first. Feeds "this is the second time" and
 *  anything that needs to show change over weeks rather than over one run. */
export async function listFindingEvents(clerkId: string, limit = 50) {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient()
    .from(T.behaviorEvents)
    .select('*')
    .eq('clerk_id', cid)
    .order('at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw error;
  return data ?? [];
}

/** The one question waiting on an answer, or null.
 *
 *  Scoped to the primary finding and to questions that have not been answered:
 *  a trader shown two open questions answers neither, and a question re-asked
 *  after it was answered reads as not having listened. */
export async function getOpenQuestion(
  clerkId: string,
): Promise<{ kind: BehaviorKind; question: string; askedAt: string | null } | null> {
  const cid = requireClerkId(clerkId);
  const { data, error } = await getClient()
    .from(T.behaviorFindings)
    .select('kind, question, question_asked_at')
    .eq('clerk_id', cid)
    .eq('is_primary', true)
    .not('question', 'is', null)
    .is('trader_answer', null)
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as { kind: string; question: string; question_asked_at: string | null } | undefined;
  if (!row) return null;
  return { kind: row.kind as BehaviorKind, question: row.question, askedAt: row.question_asked_at };
}

/** Record the trader's answer to a finding's open question.
 *
 *  This is the only write in the system that adds an evidence family beyond
 *  trade telemetry, and therefore the only route by which a finding can ever
 *  reach `high` confidence. */
export async function recordAnswer(
  clerkId: string,
  kind: BehaviorKind,
  answer: string,
): Promise<boolean> {
  const cid  = requireClerkId(clerkId);
  const text = answer.trim().slice(0, 2000);
  if (!text) return false;

  const { data, error } = await getClient()
    .from(T.behaviorFindings)
    .update({
      trader_answer:      text,
      trader_answered_at: new Date().toISOString(),
      updated_at:         new Date().toISOString(),
    })
    .eq('clerk_id', cid)
    .eq('kind', kind)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}
