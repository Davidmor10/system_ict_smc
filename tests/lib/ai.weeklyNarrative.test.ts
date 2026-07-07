import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateInsightTextMock = vi.fn();
vi.mock('../../app/lib/ai/client', () => ({
  generateInsightText: (...args: unknown[]) => generateInsightTextMock(...args),
}));

const { generateNarrativeText } = await import('../../app/lib/ai/weeklyNarrative');
import type { NarrativeFacts } from '../../app/lib/ai/weeklyNarrative';

function baseFacts(overrides: Partial<NarrativeFacts> = {}): NarrativeFacts {
  return {
    thisWeekSummary: 'OVERALL: 10 trades, winRate 70%',
    prevWeekSummary: 'OVERALL: 8 trades, winRate 50%',
    baselineSummary: null,
    comparisonSummary: 'Win rate: 70% (improved vs last week 50%)',
    patternMemorySummary: 'No recurring patterns tracked yet.',
    knownFactsSummary: 'No durable facts established yet.',
    rootCauseSummary: 'No single clear root cause stands out this week.',
    hypothesisSummary: null,
    notesObservations: [],
    isEarlyInHistory: false,
    confidenceLevel: 'medium',
    sampleSize: 10,
    ...overrides,
  };
}

describe('generateNarrativeText', () => {
  beforeEach(() => generateInsightTextMock.mockReset());

  it('never asks for the old fixed-template field names in the prompt', async () => {
    generateInsightTextMock.mockResolvedValue(JSON.stringify({ paragraphs: ['a', 'b', 'c'] }));
    await generateNarrativeText(baseFacts(), 'he');
    const prompt = generateInsightTextMock.mock.calls[0][0] as string;
    expect(prompt).not.toContain('biggestStrength');
    expect(prompt).not.toContain('biggestWeakness');
    expect(prompt).not.toContain('largestImprovement');
    expect(prompt).not.toContain('focusNextWeek');
  });

  it('includes the challenge-the-trader rule only when notes are present', async () => {
    generateInsightTextMock.mockResolvedValue(JSON.stringify({ paragraphs: ['a', 'b', 'c'] }));

    await generateNarrativeText(baseFacts({ notesObservations: [] }), 'he');
    expect(generateInsightTextMock.mock.calls[0][0]).not.toContain('OBJECTIVITY');

    await generateNarrativeText(baseFacts({ notesObservations: ['הפסדתי בגלל החדשות'] }), 'he');
    expect(generateInsightTextMock.mock.calls[1][0]).toContain('OBJECTIVITY');
    expect(generateInsightTextMock.mock.calls[1][0]).toContain('הפסדתי בגלל החדשות');
  });

  it('parses a well-formed response into paragraphs', async () => {
    generateInsightTextMock.mockResolvedValue(JSON.stringify({ paragraphs: ['פסקה ראשונה', 'פסקה שנייה', 'פסקה שלישית'] }));
    const result = await generateNarrativeText(baseFacts(), 'he');
    expect(result?.paragraphs).toHaveLength(3);
  });

  it('returns null when the model returns fewer than 3 paragraphs', async () => {
    generateInsightTextMock.mockResolvedValue(JSON.stringify({ paragraphs: ['only one'] }));
    expect(await generateNarrativeText(baseFacts(), 'he')).toBeNull();
  });

  it('returns null safely on malformed/non-JSON output instead of throwing', async () => {
    generateInsightTextMock.mockResolvedValue('not json at all');
    expect(await generateNarrativeText(baseFacts(), 'he')).toBeNull();
  });

  it('caps paragraphs at 6 even if the model returns more', async () => {
    generateInsightTextMock.mockResolvedValue(JSON.stringify({ paragraphs: ['1', '2', '3', '4', '5', '6', '7', '8'] }));
    const result = await generateNarrativeText(baseFacts(), 'he');
    expect(result?.paragraphs).toHaveLength(6);
  });
});
