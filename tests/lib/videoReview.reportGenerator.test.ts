import { describe, it, expect } from 'vitest';
import { validateAndSanitize } from '../../app/lib/videoReview/reportGenerator';
import type { TradeReviewReport, EvidencePointer } from '../../app/lib/videoReview/types';

// Empty template for building test inputs — extended per-case.
function base(): TradeReviewReport {
  return {
    whatHappened: [],
    decisionVerdict: { verdict: 'unclear', reasoning: '', confidence: 'low', evidence: [] },
    mistakes: [],
    goodDecisions: [],
    rulesBroken: [],
    recurringPatterns: [],
    overallConfidence: 'low',
    alternativeReadings: [],
    oneThingToImprove: { habit: '', whyThisOne: '', howToPractice: '', evidence: [] },
  };
}

describe('validateAndSanitize', () => {
  it('drops claims with no evidence', () => {
    const input = { ...base(), mistakes: [{ claim: 'entered without confirmation', confidence: 'medium' as const, evidence: [], kind: 'mistake' as const }] };
    expect(validateAndSanitize(input).mistakes).toHaveLength(0);
  });

  it('drops claims where every evidence pointer has an invalid source', () => {
    const bad: EvidencePointer = { source: 'not-a-source' as unknown as EvidencePointer['source'], label: 'lol' };
    const input = { ...base(), whatHappened: [{ claim: 'x', confidence: 'high' as const, evidence: [bad], kind: 'observation' as const }] };
    expect(validateAndSanitize(input).whatHappened).toHaveLength(0);
  });

  it('downgrades high→medium when evidence comes from a single source', () => {
    const input = {
      ...base(),
      goodDecisions: [{
        claim: 'x', confidence: 'high' as const, kind: 'good-decision' as const,
        evidence: [
          { source: 'transcript' as const, label: 'said A' },
          { source: 'transcript' as const, label: 'said B' },
        ],
      }],
    };
    expect(validateAndSanitize(input).goodDecisions[0].confidence).toBe('medium');
  });

  it('keeps high when evidence spans two different sources', () => {
    const input = {
      ...base(),
      goodDecisions: [{
        claim: 'x', confidence: 'high' as const, kind: 'good-decision' as const,
        evidence: [
          { source: 'transcript' as const, label: 'said A' },
          { source: 'video-frame' as const, label: 'frame at 45s', timestampSec: 45 },
        ],
      }],
    };
    expect(validateAndSanitize(input).goodDecisions[0].confidence).toBe('high');
  });

  it('normalizes an unknown verdict to "unclear"', () => {
    const input = { ...base(), decisionVerdict: { verdict: 'made-up' as unknown as TradeReviewReport['decisionVerdict']['verdict'], reasoning: '', confidence: 'medium' as const, evidence: [] } };
    expect(validateAndSanitize(input).decisionVerdict.verdict).toBe('unclear');
  });

  it('normalizes an unknown confidence to "low"', () => {
    const input = { ...base(), overallConfidence: 'super-high' as unknown as TradeReviewReport['overallConfidence'] };
    expect(validateAndSanitize(input).overallConfidence).toBe('low');
  });

  it('drops non-string alternativeReadings entries', () => {
    const input = { ...base(), alternativeReadings: ['a real reading', '', 123 as unknown as string, '   '] };
    expect(validateAndSanitize(input).alternativeReadings).toEqual(['a real reading']);
  });

  it('falls back to an empty oneThingToImprove when the habit is missing', () => {
    const input = { ...base(), oneThingToImprove: undefined as unknown as TradeReviewReport['oneThingToImprove'] };
    const out = validateAndSanitize(input);
    expect(out.oneThingToImprove.habit).toBe('');
    expect(out.oneThingToImprove.evidence).toEqual([]);
  });

  it('keeps rulesBroken claims when the evidence is valid (rule + trade-record)', () => {
    const input = {
      ...base(),
      rulesBroken: [{
        claim: 'skipped confirmation', confidence: 'high' as const, kind: 'rule-broken' as const,
        evidence: [
          { source: 'rule' as const, label: 'wait for CHoCH', refId: 'r-1' },
          { source: 'trade-record' as const, label: 'entered at 09:31', refId: 42 },
        ],
      }],
    };
    const out = validateAndSanitize(input);
    expect(out.rulesBroken).toHaveLength(1);
    expect(out.rulesBroken[0].confidence).toBe('high');
  });
});
