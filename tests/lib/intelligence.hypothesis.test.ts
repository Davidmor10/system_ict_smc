import { describe, expect, it } from 'vitest';
import { deriveHypothesis } from '../../app/lib/intelligence/hypothesis';
import type { HypothesisState, PatternMemoryRow } from '../../app/lib/intelligence/types';
import type { ConfidenceLevel } from '../../app/lib/analytics';

const CLERK_ID = 'user_A';
const NOW = '2026-07-06T12:00:00.000Z';

function row(overrides: Partial<PatternMemoryRow> & { patternId: string }): PatternMemoryRow {
  return {
    clerkId: CLERK_ID,
    kind: 'instrument+session',
    subject: { instrument: 'MNQ', session: 'nyam' },
    status: 'active',
    currentMetric: { key: overrides.patternId, label: overrides.patternId, trades: 20, wins: 14, losses: 6, winRate: 70, totalPnl: 500, avgRR: 1.5, avgWinner: 100, avgLoser: 50, profitFactor: 2, confidence: { level: 'medium', sampleSize: 20 } },
    currentConfidenceLevel: 'medium' as ConfidenceLevel,
    currentSampleSize: 20,
    baselineWinRate: 50,
    delta: 20,
    firstDetectedAt: '2026-06-01T00:00:00.000Z',
    lastSeenAt: '2026-07-01T00:00:00.000Z',
    lastUpdatedAt: '2026-07-01T00:00:00.000Z',
    consecutiveMisses: 0,
    history: [],
    aiTitle: null, aiEvidence: null, aiAction: null, aiPhrasedStatus: null, aiPhrasedWinRate: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveHypothesis', () => {
  it('returns insufficient_data with no prior hypothesis when nothing qualifies', () => {
    const h = deriveHypothesis(CLERK_ID, [row({ patternId: 'a', status: 'insufficient_data' })], null, NOW);
    expect(h.status).toBe('insufficient_data');
    expect(h.confidenceScore).toBe(0);
  });

  it('invalidates a real prior hypothesis when nothing qualifies anymore', () => {
    const previous: HypothesisState = {
      clerkId: CLERK_ID, description: 'old edge', evidence: 'old evidence', supportingPatternIds: ['MNQ_nyam'],
      supportingMetrics: {}, confidenceScore: 80, status: 'active', firstDetectedAt: '2026-05-01T00:00:00.000Z',
      lastUpdatedAt: '2026-06-01T00:00:00.000Z', aiPhrasedStatus: 'active', aiPhrasedConfidence: 80, createdAt: '2026-05-01T00:00:00.000Z',
    };
    const h = deriveHypothesis(CLERK_ID, [], previous, NOW);
    expect(h.status).toBe('invalidated');
    expect(h.description).toBe(previous.description); // keeps the last known description for the narrative to reference
  });

  it('starts a fresh hypothesis (no cached phrasing) the first time a pattern qualifies', () => {
    const h = deriveHypothesis(CLERK_ID, [row({ patternId: 'MNQ_nyam', status: 'active' })], null, NOW);
    expect(h.status).toBe('active');
    expect(h.description).toBeNull(); // signals the service layer to phrase it via LLM
    expect(h.supportingPatternIds).toEqual(['MNQ_nyam']);
    expect(h.firstDetectedAt).toBe(NOW);
  });

  it('carries the same hypothesis forward (keeps cached phrasing) when the same anchor pattern strengthens', () => {
    const previous: HypothesisState = {
      clerkId: CLERK_ID, description: 'cached description', evidence: 'cached evidence', supportingPatternIds: ['MNQ_nyam'],
      supportingMetrics: {}, confidenceScore: 60, status: 'active', firstDetectedAt: '2026-05-01T00:00:00.000Z',
      lastUpdatedAt: '2026-06-01T00:00:00.000Z', aiPhrasedStatus: 'active', aiPhrasedConfidence: 60, createdAt: '2026-05-01T00:00:00.000Z',
    };
    const h = deriveHypothesis(CLERK_ID, [row({ patternId: 'MNQ_nyam', status: 'strengthening' })], previous, NOW);
    expect(h.status).toBe('strengthening');
    expect(h.description).toBe('cached description'); // untouched — no re-phrase needed
    expect(h.firstDetectedAt).toBe('2026-05-01T00:00:00.000Z'); // identity preserved
  });

  it('treats a different anchor pattern as a brand-new hypothesis, clearing cached phrasing', () => {
    const previous: HypothesisState = {
      clerkId: CLERK_ID, description: 'old edge about MNQ', evidence: 'old evidence', supportingPatternIds: ['MNQ_nyam'],
      supportingMetrics: {}, confidenceScore: 60, status: 'active', firstDetectedAt: '2026-05-01T00:00:00.000Z',
      lastUpdatedAt: '2026-06-01T00:00:00.000Z', aiPhrasedStatus: 'active', aiPhrasedConfidence: 60, createdAt: '2026-05-01T00:00:00.000Z',
    };
    const h = deriveHypothesis(CLERK_ID, [row({ patternId: 'ES_london', status: 'strengthening', subject: { instrument: 'ES', session: 'london' } })], previous, NOW);
    expect(h.supportingPatternIds).toEqual(['ES_london']);
    expect(h.description).toBeNull();
    expect(h.firstDetectedAt).toBe(NOW);
  });

  it('gives a higher confidence score when corroborating patterns share the same subject', () => {
    const anchorOnly = deriveHypothesis(CLERK_ID, [row({ patternId: 'MNQ_nyam', currentConfidenceLevel: 'medium' as ConfidenceLevel })], null, NOW);
    const withCorroborator = deriveHypothesis(CLERK_ID, [
      row({ patternId: 'MNQ_nyam', currentConfidenceLevel: 'medium' as ConfidenceLevel }),
      row({ patternId: 'MNQ_ifvg', status: 'active', subject: { instrument: 'MNQ', confirmation: 'IFVG' } }),
    ], null, NOW);
    expect(withCorroborator.confidenceScore).toBeGreaterThan(anchorOnly.confidenceScore);
    expect(withCorroborator.supportingPatternIds).toContain('MNQ_ifvg');
  });
});
