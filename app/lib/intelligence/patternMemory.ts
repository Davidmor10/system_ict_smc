// ─────────────────────────────────────────────────────────────────────────────
// Pure pattern-lifecycle diffing. Takes this run's freshly-discovered
// PatternCandidates (already ≥3-trade-filtered and ranked by
// app/lib/analytics/patterns.ts's discoverPatterns) and the previously stored
// pattern_memory rows for this user, and decides — per pattern id — whether
// it's brand new, strengthening, weakening, missing-but-not-gone-yet, or
// truly disappeared. No I/O, no LLM; the service layer persists the result.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConfidenceLevel, PatternCandidate } from '../analytics';
import { pointFloor } from './movement';
import type { PatternMemoryRow, PatternStatus } from './types';

const HISTORY_CAP = 12;
/** The floor, not the rule — see `statusFloor`. One constant now, applied
    symmetrically: a move up and a move down are the same size of move. */
const STATUS_THRESHOLD = 3; // percentage points
/** One quiet run shouldn't flap a real pattern to "disappeared" and back;
    require two consecutive misses. This mattered more when a page visit was
    the only trigger and two misses could be weeks apart; with the nightly
    refresh it is two nights. */
const MISSES_BEFORE_DISAPPEARED = 2;

/** How far a pattern's gap must move between runs before the move is a change
 *  of state rather than the last trade.
 *
 *  THE FIXED THRESHOLD WAS SMALLER THAN ONE TRADE
 *
 *  Three percentage points is a reasonable bar between two runs weeks apart,
 *  and that is what these runs used to be: nothing scheduled ever refreshed
 *  this stack, so it only ran when a trader opened the weekly report. Once it
 *  runs nightly, three points is less than a single result — a slice of
 *  fifteen trades moves about seven — and a pattern would read 'strengthening'
 *  the morning after a win and 'weakening' the morning after a loss, for as
 *  long as the trader kept trading.
 *
 *  That is not a harmless label. The status is quoted to the coach in the
 *  facts block, downstream surfaces filter on active/strengthening, and every
 *  flip writes a row into the pattern's own history — so the history meant to
 *  show whether an edge is holding would fill with the noise of individual
 *  trades.
 *
 *  Measured against the smaller of the two samples, because that is the one
 *  the comparison rests on. */
function statusFloor(fixed: number, sampleNow: number, sampleBefore: number): number {
  return pointFloor(Math.abs(fixed), Math.min(sampleNow, sampleBefore));
}

const TIER_RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };

export interface PatternStatusChange {
  patternId: string;
  previousStatus: PatternStatus | null;
  newStatus: PatternStatus;
}

export interface PatternMemoryDiffResult {
  toUpsert: PatternMemoryRow[];
  statusChanges: PatternStatusChange[];
}

function pushHistory(existingHistory: PatternMemoryRow['history'], entry: PatternMemoryRow['history'][number]): PatternMemoryRow['history'] {
  return [...existingHistory, entry].slice(-HISTORY_CAP);
}

/** A pattern only becomes 'active' — the status every downstream surface
 *  treats as "this is real" — once it has survived the significance test that
 *  discoverPatterns now applies.
 *
 *  Sample size alone was the previous bar, and sample size cannot see the
 *  problem: discovery deliberately produces ~100 overlapping slices, and at
 *  100 comparisons several of them clear any win-rate gap by chance, for every
 *  trader, every run. Those slices were being promoted to 'active' and read
 *  back out as the trader's edge, their dashboard headline, and their Edge
 *  Score. Everything downstream inherits this one line. */
function statusForCandidate(c: PatternCandidate): PatternStatus {
  if (c.confidence.level === 'low') return 'insufficient_data';
  return c.significant ? 'active' : 'insufficient_data';
}

function buildRow(
  clerkId: string,
  c: PatternCandidate,
  nowISO: string,
  status: PatternStatus,
  firstDetectedAt: string,
  history: PatternMemoryRow['history'],
): PatternMemoryRow {
  return {
    clerkId,
    patternId: c.id,
    kind: c.kind,
    subject: c.subject,
    status,
    currentMetric: c.metric,
    currentConfidenceLevel: c.confidence.level,
    currentSampleSize: c.confidence.sampleSize,
    baselineWinRate: c.baseline,
    delta: c.delta,
    firstDetectedAt,
    lastSeenAt: nowISO,
    lastUpdatedAt: nowISO,
    consecutiveMisses: 0,
    history,
    aiTitle: null,
    aiEvidence: null,
    aiAction: null,
    aiPhrasedStatus: null,
    aiPhrasedWinRate: null,
    createdAt: firstDetectedAt,
  };
}

/** Pure: diffs this run's pattern candidates against the previously stored
    rows and returns exactly what the service layer should upsert, plus a log
    of every status transition (used for ai_insight_history). */
export function diffPatternMemory(
  clerkId: string,
  current: PatternCandidate[],
  stored: PatternMemoryRow[],
  nowISO: string,
): PatternMemoryDiffResult {
  const storedById = new Map(stored.map(r => [r.patternId, r]));
  const currentIds = new Set(current.map(c => c.id));
  const toUpsert: PatternMemoryRow[] = [];
  const statusChanges: PatternStatusChange[] = [];

  for (const c of current) {
    const existing = storedById.get(c.id);

    if (!existing || existing.status === 'disappeared') {
      // Brand new, or reappearing after having disappeared: judge purely on
      // current confidence, keep original identity (first_detected_at,
      // pattern_id) if this is a reappearance, otherwise start fresh.
      const status = statusForCandidate(c);
      const firstDetectedAt = existing?.firstDetectedAt ?? nowISO;
      const history = pushHistory(existing?.history ?? [], {
        at: nowISO, winRate: c.metric.winRate, delta: c.delta, confidenceLevel: c.confidence.level, sampleSize: c.confidence.sampleSize, status,
      });
      const row = buildRow(clerkId, c, nowISO, status, firstDetectedAt, history);
      row.createdAt = existing?.createdAt ?? nowISO;
      toUpsert.push(row);
      statusChanges.push({ patternId: c.id, previousStatus: existing?.status ?? null, newStatus: status });
      continue;
    }

    // Existing, still-live pattern: compare against its last stored snapshot.
    const deltaVsBaseline = c.delta - existing.delta;
    const tierNow = TIER_RANK[c.confidence.level];
    const tierBefore = TIER_RANK[existing.currentConfidenceLevel];
    const signFlipped = (c.delta > 0 && existing.delta < 0) || (c.delta < 0 && existing.delta > 0);
    const floor = statusFloor(STATUS_THRESHOLD, c.confidence.sampleSize, existing.currentSampleSize);

    let status: PatternStatus;
    if (!c.significant) {
      // Lost the test — whatever the delta did. A slice whose gap no longer
      // survives correction is not "strengthening", it is a slice that used to
      // look convincing, and saying otherwise is how a pattern outlives the
      // evidence that created it.
      status = c.confidence.level === 'low' ? 'insufficient_data' : 'weakening';
    } else if (signFlipped) {
      status = 'weakening';
    } else if (deltaVsBaseline >= floor || tierNow > tierBefore) {
      // A confidence tier that actually changed is a change in what the
      // sample can support, not a wobble in the rate, and moves the status on
      // its own.
      status = 'strengthening';
    } else if (deltaVsBaseline <= -floor || tierNow < tierBefore) {
      status = 'weakening';
    } else {
      status = statusForCandidate(c);
    }

    const row = buildRow(clerkId, c, nowISO, status, existing.firstDetectedAt, pushHistory(existing.history, {
      at: nowISO, winRate: c.metric.winRate, delta: c.delta, confidenceLevel: c.confidence.level, sampleSize: c.confidence.sampleSize, status,
    }));
    row.createdAt = existing.createdAt;
    toUpsert.push(row);
    if (status !== existing.status) statusChanges.push({ patternId: c.id, previousStatus: existing.status, newStatus: status });
  }

  for (const existing of stored) {
    if (currentIds.has(existing.patternId) || existing.status === 'disappeared') continue;
    const consecutiveMisses = existing.consecutiveMisses + 1;
    // A pattern that this run did not find is not a pattern the trader
    // currently has. The grace period before 'disappeared' exists to protect
    // the row's IDENTITY — its history, its first_detected_at — from a single
    // noisy run, not to keep asserting its last claim. Leaving the status at
    // 'active' did exactly that: every consumer filters on active /
    // strengthening, so a slice whose trades had since been deleted went on
    // being quoted as live evidence, with the sample size it had on the day it
    // was last seen.
    const status: PatternStatus = consecutiveMisses >= MISSES_BEFORE_DISAPPEARED
      ? 'disappeared'
      : 'insufficient_data';
    toUpsert.push({ ...existing, consecutiveMisses, status, lastUpdatedAt: status !== existing.status ? nowISO : existing.lastUpdatedAt });
    if (status !== existing.status) statusChanges.push({ patternId: existing.patternId, previousStatus: existing.status, newStatus: status });
  }

  return { toUpsert, statusChanges };
}
