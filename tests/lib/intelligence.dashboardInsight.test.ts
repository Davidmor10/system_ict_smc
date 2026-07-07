import { describe, expect, it } from 'vitest';
import { selectPrimaryPattern } from '../../app/lib/intelligence/dashboardInsight';
import type { PatternMemoryRow, PatternStatus } from '../../app/lib/intelligence/types';
import type { ConfidenceLevel } from '../../app/lib/analytics';

function row(overrides: Partial<PatternMemoryRow> & { patternId: string }): PatternMemoryRow {
  return {
    clerkId: 'user_A',
    kind: 'instrument_best',
    subject: { instrument: 'ES' },
    status: 'active',
    currentMetric: { key: overrides.patternId, label: overrides.patternId, trades: 20, wins: 12, losses: 8, winRate: 60, totalPnl: 0, avgRR: 1, avgWinner: 100, avgLoser: 50, profitFactor: 2, confidence: { level: 'medium', sampleSize: 20 } },
    currentConfidenceLevel: 'medium',
    currentSampleSize: 20,
    baselineWinRate: 50,
    delta: 10,
    firstDetectedAt: '2026-06-01T00:00:00.000Z',
    lastSeenAt: '2026-07-01T00:00:00.000Z',
    lastUpdatedAt: '2026-07-01T00:00:00.000Z',
    consecutiveMisses: 0,
    history: [],
    aiTitle: null,
    aiEvidence: null,
    aiAction: null,
    aiPhrasedStatus: null,
    aiPhrasedWinRate: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('selectPrimaryPattern', () => {
  it('returns null when there is nothing active, strengthening, or weakening', () => {
    const patterns = [row({ patternId: 'a', status: 'insufficient_data' }), row({ patternId: 'b', status: 'disappeared' })];
    expect(selectPrimaryPattern(patterns)).toBeNull();
  });

  it('falls back to a weakening pattern only when no active/strengthening one exists', () => {
    const patterns = [row({ patternId: 'a', status: 'weakening' })];
    expect(selectPrimaryPattern(patterns)?.patternId).toBe('a');
  });

  it('prefers higher confidence tier above everything else', () => {
    const patterns = [
      row({ patternId: 'low', currentConfidenceLevel: 'low' as ConfidenceLevel, status: 'strengthening', delta: 50 }),
      row({ patternId: 'high', currentConfidenceLevel: 'high' as ConfidenceLevel, status: 'active', delta: 5 }),
    ];
    expect(selectPrimaryPattern(patterns)?.patternId).toBe('high');
  });

  it('breaks a confidence tie by status priority (strengthening > active > weakening)', () => {
    const patterns = [
      row({ patternId: 'active', status: 'active' as PatternStatus }),
      row({ patternId: 'strengthening', status: 'strengthening' as PatternStatus }),
    ];
    expect(selectPrimaryPattern(patterns)?.patternId).toBe('strengthening');
  });

  it('breaks a tier+status tie by larger |delta|', () => {
    const patterns = [
      row({ patternId: 'small', delta: 4 }),
      row({ patternId: 'big', delta: -20 }),
    ];
    expect(selectPrimaryPattern(patterns)?.patternId).toBe('big');
  });

  it('breaks a full tie by most recently updated', () => {
    const patterns = [
      row({ patternId: 'older', lastUpdatedAt: '2026-06-01T00:00:00.000Z' }),
      row({ patternId: 'newer', lastUpdatedAt: '2026-07-01T00:00:00.000Z' }),
    ];
    expect(selectPrimaryPattern(patterns)?.patternId).toBe('newer');
  });
});
