import { describe, expect, it } from 'vitest';
import { diffPatternMemory } from '../../app/lib/intelligence/patternMemory';
import type { PatternCandidate, ConfidenceLevel } from '../../app/lib/analytics';
import type { PatternMemoryRow, PatternStatus } from '../../app/lib/intelligence/types';

const CLERK_ID = 'user_A';
const NOW = '2026-07-06T12:00:00.000Z';

function candidate(id: string, delta: number, level: ConfidenceLevel, sampleSize = 20, winRate = 60): PatternCandidate {
  return {
    id,
    kind: 'instrument_best',
    subject: { instrument: 'ES' },
    metric: { key: id, label: id, trades: sampleSize, wins: Math.round(sampleSize * winRate / 100), losses: sampleSize - Math.round(sampleSize * winRate / 100), winRate, totalPnl: 0, avgRR: 1, avgWinner: 100, avgLoser: 50, profitFactor: 2, confidence: { level, sampleSize } },
    baseline: 50,
    delta,
    confidence: { level, sampleSize },
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

  it('does not mark a pattern disappeared after a single missed run', () => {
    const stored = [storedRow({ consecutiveMisses: 0 })];
    const result = diffPatternMemory(CLERK_ID, [], stored, NOW);
    expect(statusOf(result, 'ES_edge')).toBe('active');
    const row = result.toUpsert[0];
    expect(row.consecutiveMisses).toBe(1);
  });

  it('marks a pattern disappeared after two consecutive missed runs', () => {
    const stored = [storedRow({ consecutiveMisses: 1 })];
    const result = diffPatternMemory(CLERK_ID, [], stored, NOW);
    expect(statusOf(result, 'ES_edge')).toBe('disappeared');
    expect(result.statusChanges).toEqual([{ patternId: 'ES_edge', previousStatus: 'active', newStatus: 'disappeared' }]);
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
