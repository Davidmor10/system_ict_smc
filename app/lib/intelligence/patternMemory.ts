// ─────────────────────────────────────────────────────────────────────────────
// Pure pattern-lifecycle diffing. Takes this run's freshly-discovered
// PatternCandidates (already ≥3-trade-filtered and ranked by
// app/lib/analytics/patterns.ts's discoverPatterns) and the previously stored
// pattern_memory rows for this user, and decides — per pattern id — whether
// it's brand new, strengthening, weakening, missing-but-not-gone-yet, or
// truly disappeared. No I/O, no LLM; the service layer persists the result.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConfidenceLevel, PatternCandidate } from '../analytics';
import type { PatternMemoryRow, PatternStatus } from './types';

const HISTORY_CAP = 12;
const STRENGTHEN_THRESHOLD = 3; // percentage points, matches the pp thresholds used elsewhere
const WEAKEN_THRESHOLD = -3;
/** No cron in this app — a page visit is the only trigger. One quiet run
    between visits shouldn't flap a real pattern to "disappeared" and back;
    require two consecutive misses. */
const MISSES_BEFORE_DISAPPEARED = 2;

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

function statusForNewOrReappeared(confidence: ConfidenceLevel): PatternStatus {
  return confidence === 'low' ? 'insufficient_data' : 'active';
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
      const status = statusForNewOrReappeared(c.confidence.level);
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

    let status: PatternStatus;
    if (signFlipped) {
      status = 'weakening';
    } else if (deltaVsBaseline >= STRENGTHEN_THRESHOLD || tierNow > tierBefore) {
      status = 'strengthening';
    } else if (deltaVsBaseline <= WEAKEN_THRESHOLD || tierNow < tierBefore) {
      status = 'weakening';
    } else {
      status = c.confidence.level === 'low' ? 'insufficient_data' : 'active';
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
    const status: PatternStatus = consecutiveMisses >= MISSES_BEFORE_DISAPPEARED ? 'disappeared' : existing.status;
    toUpsert.push({ ...existing, consecutiveMisses, status, lastUpdatedAt: status !== existing.status ? nowISO : existing.lastUpdatedAt });
    if (status !== existing.status) statusChanges.push({ patternId: existing.patternId, previousStatus: existing.status, newStatus: status });
  }

  return { toUpsert, statusChanges };
}
