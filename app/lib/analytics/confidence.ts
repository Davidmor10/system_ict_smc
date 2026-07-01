import type { Confidence, ConfidenceLevel } from './types';

/** Sample-size rule shared by every analyzer: <10 relevant trades = low,
    10-29 = medium, 30+ = high. "Relevant" means decided (WIN/LOSS) trades —
    the count a win rate or profit factor is actually computed over. */
export function confidenceLevelFor(sampleSize: number): ConfidenceLevel {
  if (sampleSize < 10) return 'low';
  if (sampleSize < 30) return 'medium';
  return 'high';
}

export function confidenceFor(sampleSize: number): Confidence {
  return { level: confidenceLevelFor(sampleSize), sampleSize };
}
