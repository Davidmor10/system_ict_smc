import { describe, expect, it } from 'vitest';
import { diffPatternMemory } from '../../app/lib/intelligence/patternMemory';
import type { PatternCandidate, ConfidenceLevel } from '../../app/lib/analytics';
import type { PatternMemoryRow, PatternStatus } from '../../app/lib/intelligence/types';

const CLERK_ID = 'user_A';
const NOW = '2026-07-06T12:00:00.000Z';

/** `significant` defaults to true so the existing lifecycle tests keep testing
    the lifecycle. The significance gate itself is exercised explicitly below —
    it is a separate question from "does a strengthening delta strengthen". */
function candidate(id: string, delta: number, level: ConfidenceLevel, sampleSize = 20, winRate = 60, significant = true): PatternCandidate {
  return {
    id,
    kind: 'instrument_best',
    subject: { instrument: 'ES' },
    metric: { key: id, label: id, trades: sampleSize, wins: Math.round(sampleSize * winRate / 100), losses: sampleSize - Math.round(sampleSize * winRate / 100), winRate, totalPnl: 0, avgRR: 1, rrSample: 0, rrStdDev: null, avgWinner: 100, avgLoser: 50, profitFactor: 2, confidence: { level, sampleSize } },
    baseline: 50,
    delta,
    confidence: { level, sampleSize },
    pValue: significant ? 0.0001 : 0.4,
    pAdjusted: significant ? 0.01 : 1,
    significant,
  };
}

function storedRow(overrides: Partial<PatternMemoryRow> = {}): PatternMemoryRow {
  return {
    clerkId: CLERK_ID,
    patternId: 'ES_edge',
    kind: 'instrument_best',
    subject: { instrument: 'ES' },
    status: 'active',
    currentMetric: candidate('ES_edge', 10, 'medium').metric,
    currentConfidenceLevel: 'medium',
    currentSampleSize: 20,
    baselineWinRate: 50,
    delta: 10,
    firstDetectedAt: '2026-06-01T00:00:00.000Z',
    lastSeenAt: '2026-06-29T00:00:00.000Z',
    lastUpdatedAt: '2026-06-29T00:00:00.000Z',
    consecutiveMisses: 0,
    history: [{ at: '2026-06-29T00:00:00.000Z', winRate: 60, delta: 10, confidenceLevel: 'medium', sampleSize: 20, status: 'active' }],
    aiTitle: null,
    aiEvidence: null,
    aiAction: null,
    aiPhrasedStatus: null,
    aiPhrasedWinRate: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function statusOf(result: ReturnType<typeof diffPatternMemory>, id: string): PatternStatus {
  const row = result.toUpsert.find(r => r.patternId === id);
  if (!row) throw new Error(`no row for ${id}`);
  return row.status;
}

describe('diffPatternMemory', () => {
  it('marks a brand-new low-confidence pattern as insufficient_data', () => {
    const result = diffPatternMemory(CLERK_ID, [candidate('NQ_edge', 8, 'low', 5)], [], NOW);
    expect(statusOf(result, 'NQ_edge')).toBe('insufficient_data');
    expect(result.statusChanges).toEqual([{ patternId: 'NQ_edge', previousStatus: null, newStatus: 'insufficient_data' }]);
  });

  it('marks a brand-new medium/high-confidence pattern as active', () => {
    const result = diffPatternMemory(CLERK_ID, [candidate('NQ_edge', 8, 'high', 40)], [], NOW);
    expect(statusOf(result, 'NQ_edge')).toBe('active');
  });

  it('marks an existing pattern strengthening when it moves further from baseline', () => {
    const stored = [storedRow({ delta: 10 })];
    const result = diffPatternMemory(CLERK_ID, [candidate('ES_edge', 20, 'medium')], stored, NOW);
    expect(statusOf(result, 'ES_edge')).toBe('strengthening');
  });

  it('marks an existing pattern strengthening when its confidence tier improves, even with a small delta move', () => {
    const stored = [storedRow({ delta: 10, currentConfidenceLevel: 'medium' })];
    const result = diffPatternMemory(CLERK_ID, [candidate('ES_edge', 11, 'high')], stored, NOW);
    expect(statusOf(result, 'ES_edge')).toBe('strengthening');
  });

  it('marks an existing pattern weakening when it moves toward baseline', () => {
    const stored = [storedRow({ delta: 10 })];
    const result = diffPatternMemory(CLERK_ID, [candidate('ES_edge', 2, 'medium')], stored, NOW);
    expect(statusOf(result, 'ES_edge')).toBe('weakening');
  });

  it('marks an existing pattern weakening unconditionally when its edge reverses sign', () => {
    const stored = [storedRow({ delta: 10 })];
    // Delta magnitude actually grew (-15 vs 10), but the direction flipped — still weakening.
    const result = diffPatternMemory(CLERK_ID, [candidate('ES_edge', -15, 'high')], stored, NOW);
    expect(statusOf(result, 'ES_edge')).toBe('weakening');
  });

  it('keeps a stable existing pattern active', () => {
    const stored = [storedRow({ delta: 10 })];
    const result = diffPatternMemory(CLERK_ID, [candidate('ES_edge', 11, 'medium')], stored, NOW);
    expect(statusOf(result, 'ES_edge')).toBe('active');
  });

  it('keeps a pattern missed once, but stops calling it current evidence', () => {
    // The grace period protects the row's IDENTITY from one noisy run — its
    // history, its first_detected_at, its place in the table. It must not keep
    // the pattern in the active/strengthening set that every consumer reads as
    // "this is true of the trader right now": a slice whose trades have since
    // been deleted would go on being quoted, at the sample size it had on the
    // day it was last seen.
    const stored = [storedRow({ consecutiveMisses: 0 })];
    const result = diffPatternMemory(CLERK_ID, [], stored, NOW);

    const row = result.toUpsert[0];
    expect(row.status).toBe('insufficient_data');
    expect(row.status).not.toBe('disappeared');
    expect(row.consecutiveMisses).toBe(1);
    expect(row.firstDetectedAt).toBe(stored[0].firstDetectedAt);
    expect(result.statusChanges).toEqual([
      { patternId: 'ES_edge', previousStatus: 'active', newStatus: 'insufficient_data' },
    ]);
  });

  it('lets a pattern missed once come back as active when it is found again', () => {
    const missedOnce = diffPatternMemory(CLERK_ID, [], [storedRow({ consecutiveMisses: 0 })], NOW).toUpsert;
    const backAgain = diffPatternMemory(CLERK_ID, [candidate('ES_edge', 11, 'medium')], missedOnce, NOW);
    expect(statusOf(backAgain, 'ES_edge')).toBe('active');
    expect(backAgain.toUpsert[0].consecutiveMisses).toBe(0);
  });

  it('marks a pattern disappeared after two consecutive missed runs', () => {
    const stored = [storedRow({ consecutiveMisses: 1, status: 'insufficient_data' })];
    const result = diffPatternMemory(CLERK_ID, [], stored, NOW);
    expect(statusOf(result, 'ES_edge')).toBe('disappeared');
    expect(result.statusChanges).toEqual([{ patternId: 'ES_edge', previousStatus: 'insufficient_data', newStatus: 'disappeared' }]);
  });

  it('treats a reappearance after disappeared like a new detection, but keeps original identity', () => {
    const stored = [storedRow({ status: 'disappeared', firstDetectedAt: '2026-01-01T00:00:00.000Z', delta: -50 })];
    const result = diffPatternMemory(CLERK_ID, [candidate('ES_edge', 3, 'medium')], stored, NOW);
    const row = result.toUpsert[0];
    expect(row.status).toBe('active'); // judged fresh on current confidence, not the old -50 delta
    expect(row.firstDetectedAt).toBe('2026-01-01T00:00:00.000Z'); // identity preserved
  });

  it('caps history at 12 entries', () => {
    const longHistory = Array.from({ length: 12 }, (_, i) => ({
      at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, winRate: 60, delta: 10, confidenceLevel: 'medium' as const, sampleSize: 20, status: 'active' as const,
    }));
    const stored = [storedRow({ history: longHistory })];
    const result = diffPatternMemory(CLERK_ID, [candidate('ES_edge', 11, 'medium')], stored, NOW);
    expect(result.toUpsert[0].history.length).toBe(12);
    expect(result.toUpsert[0].history[11].at).toBe(NOW);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The significance gate
//
// 'active' is the status every downstream surface reads as "this is real" —
// the dashboard headline, the personalized insights, Working Strengths, the
// Edge Score. Sample size alone used to be the bar, and sample size cannot see
// the problem: discovery produces ~100 overlapping slices, so several clear
// any win-rate gap by chance for every trader, every run.
// ═══════════════════════════════════════════════════════════════════════════

describe('significance gate', () => {
  it('will not promote a large-sample slice that failed the correction', () => {
    const c = candidate('p1', 20, 'high', 40, 70, false);
    const { toUpsert } = diffPatternMemory(CLERK_ID, [c], [], NOW);
    expect(toUpsert[0].status).toBe('insufficient_data');
  });

  it('promotes the same slice once it survives', () => {
    const c = candidate('p1', 20, 'high', 40, 70, true);
    const { toUpsert } = diffPatternMemory(CLERK_ID, [c], [], NOW);
    expect(toUpsert[0].status).toBe('active');
  });

  // A pattern that stops surviving must not keep its standing on the strength
  // of a delta that moved — that is how a pattern outlives its evidence.
  it('demotes a live pattern that stops surviving, even when its delta grew', () => {
    const first = diffPatternMemory(CLERK_ID, [candidate('p1', 10, 'high', 40, 65, true)], [], NOW);
    expect(first.toUpsert[0].status).toBe('active');

    const later = diffPatternMemory(
      CLERK_ID,
      [candidate('p1', 25, 'high', 40, 75, false)],   // bigger gap, no longer significant
      first.toUpsert,
      NOW,
    );
    expect(later.toUpsert[0].status).toBe('weakening');
  });
});

// ── one trade is not a change of state ──────────────────────────────────────
//
// The threshold between runs was a fixed three percentage points. That was a
// reasonable bar while runs were weeks apart — nothing scheduled refreshed
// this stack, so it only ran when a trader opened the weekly report. Run
// nightly, three points is less than a single trade: a slice of twenty moves
// five points on one result, a slice of fifteen nearly seven. The status would
// have read 'strengthening' the morning after a win and 'weakening' the
// morning after a loss, indefinitely — quoted to the coach in the facts block
// and written into the pattern's own history every time it flipped.

describe('status floor scales with the slice', () => {
  const stored = [storedRow({ delta: 10, currentSampleSize: 20 })];

  it('holds steady on a move one trade could account for', () => {
    // Twenty trades: one result is worth five points, so four is noise.
    const result = diffPatternMemory(CLERK_ID, [candidate('ES_edge', 14, 'medium', 20)], stored, NOW);
    expect(statusOf(result, 'ES_edge')).toBe('active');
  });

  it('moves once the change outgrows one trade', () => {
    const result = diffPatternMemory(CLERK_ID, [candidate('ES_edge', 16, 'medium', 20)], stored, NOW);
    expect(statusOf(result, 'ES_edge')).toBe('strengthening');
  });

  it('applies the same size of move downward', () => {
    expect(statusOf(diffPatternMemory(CLERK_ID, [candidate('ES_edge', 6, 'medium', 20)], stored, NOW), 'ES_edge')).toBe('active');
    expect(statusOf(diffPatternMemory(CLERK_ID, [candidate('ES_edge', 4, 'medium', 20)], stored, NOW), 'ES_edge')).toBe('weakening');
  });

  it('asks for a bigger move from a smaller slice', () => {
    // Ten trades a side: one result is worth ten points, and a six-point move
    // that would count on a slice of twenty does not count here.
    const small = [storedRow({ delta: 10, currentSampleSize: 10 })];
    expect(statusOf(diffPatternMemory(CLERK_ID, [candidate('ES_edge', 16, 'medium', 10)], small, NOW), 'ES_edge')).toBe('active');
    expect(statusOf(diffPatternMemory(CLERK_ID, [candidate('ES_edge', 21, 'medium', 10)], small, NOW), 'ES_edge')).toBe('strengthening');
  });

  it('still moves on a real change of confidence tier', () => {
    // Not a wobble in the rate — a change in what the sample can support.
    const result = diffPatternMemory(CLERK_ID, [candidate('ES_edge', 11, 'high', 40)], stored, NOW);
    expect(statusOf(result, 'ES_edge')).toBe('strengthening');
  });

  it('still demotes a pattern that stops surviving the correction', () => {
    const result = diffPatternMemory(CLERK_ID, [candidate('ES_edge', 11, 'medium', 20, 60, false)], stored, NOW);
    expect(statusOf(result, 'ES_edge')).toBe('weakening');
  });
});
