import { describe, expect, it } from 'vitest';
import { buildEvolutionTimeline, type WeeklyHypothesisRecord } from '../../app/lib/intelligence/evolutionTimeline';
import type { HypothesisStatus } from '../../app/lib/intelligence/types';

function record(isoWeek: string, weekStartDate: string, description: string | null, status: HypothesisStatus = 'active'): WeeklyHypothesisRecord {
  return { isoWeek, weekStartDate, hypothesis: description === null ? null : { description, status, confidenceScore: 70 } };
}

describe('buildEvolutionTimeline', () => {
  it('condenses consecutive weeks with the same hypothesis into one range', () => {
    const timeline = buildEvolutionTimeline([
      record('2026-W01', '2026-01-05', 'London Longs'),
      record('2026-W02', '2026-01-12', 'London Longs'),
      record('2026-W03', '2026-01-19', 'London Longs'),
    ]);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ fromIsoWeek: '2026-W01', toIsoWeek: '2026-W03', description: 'London Longs' });
  });

  it('starts a new entry when the hypothesis changes', () => {
    const timeline = buildEvolutionTimeline([
      record('2026-W01', '2026-01-05', 'London Longs'),
      record('2026-W04', '2026-01-26', 'NY AM with IFVG'),
      record('2026-W09', '2026-03-02', null, 'weakening'),
    ]);
    expect(timeline.map(e => e.description)).toEqual(['London Longs', 'NY AM with IFVG', null]);
  });

  it('sorts out-of-order input chronologically before condensing', () => {
    const timeline = buildEvolutionTimeline([
      record('2026-W04', '2026-01-26', 'NY AM with IFVG'),
      record('2026-W01', '2026-01-05', 'London Longs'),
    ]);
    expect(timeline.map(e => e.fromIsoWeek)).toEqual(['2026-W01', '2026-W04']);
  });
});
