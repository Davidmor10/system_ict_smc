import { describe, expect, it } from 'vitest';
import { diagnoseRootCause } from '../../app/lib/intelligence/rootCause';
import type { PeriodComparison, TraderProfile, Trend } from '../../app/lib/intelligence/types';
import type { ExitBehavior } from '../../app/lib/analytics';

const EMPTY_EXIT: ExitBehavior = { sampleSize: 0, winnerCount: 0, captureRatio: null, winnersCutShort: 0, partialExitRate: 0, avgWinnerR: 0, avgLoserR: 0 };

function metric(current: number, prevWeek: number | null, trend: Trend) {
  return { current, prevWeek, baseline4wk: null, deltaVsPrevWeek: prevWeek !== null ? current - prevWeek : null, deltaVsBaseline: null, trend };
}

function comparison(winRate: ReturnType<typeof metric>, avgRR: ReturnType<typeof metric>, profitFactor: ReturnType<typeof metric>, hasPrevWeek = true): PeriodComparison {
  return {
    schemaVersion: 1, winRate, avgRR, profitFactor,
    concentration: { isOverReliant: false, overRelianceSubject: null, slices: [] },
    hasPrevWeek, hasBaseline: false,
  };
}

function profile(exitRatio: number | null): TraderProfile {
  return {
    schemaVersion: 1, strongestInstrument: null, weakestInstrument: null, strongestSession: null, weakestSession: null,
    bestHour: null, worstHour: null, direction: { edge: 'none', longWinRate: 0, shortWinRate: 0 },
    winRate: { current: 0, trend: 'flat' }, avgRR: { current: 0, trend: 'flat' }, profitFactor: { current: 0, trend: 'flat' },
    exitBehavior: { ratio: exitRatio, detail: EMPTY_EXIT }, topConfirmations: [], screenshotAvailability: { pct: 0, count: 0, totalClosed: 0 },
    notesObservations: [], recurringConditions: [], changesVsPrevious: [],
  };
}

describe('diagnoseRootCause', () => {
  it('returns null with no previous week to compare against', () => {
    const c = comparison(metric(70, null, 'flat'), metric(1.2, null, 'flat'), metric(2, null, 'flat'), false);
    expect(diagnoseRootCause(c, profile(1), null)).toBeNull();
  });

  it('diagnoses exit_management when win rate holds but avgRR and PF both drop', () => {
    const c = comparison(metric(70, 68, 'flat'), metric(1.2, 2.1, 'down'), metric(1.5, 2.5, 'down'));
    const finding = diagnoseRootCause(c, profile(0.6), profile(1.1));
    expect(finding?.kind).toBe('exit_management');
    expect(finding?.headlineMetric).toBe('avgRR');
  });

  it('diagnoses loss_sizing when win rate and avgRR hold but PF still drops', () => {
    const c = comparison(metric(70, 68, 'flat'), metric(1.5, 1.4, 'flat'), metric(1.3, 2.2, 'down'));
    const finding = diagnoseRootCause(c, profile(1), profile(1));
    expect(finding?.kind).toBe('loss_sizing');
  });

  it('diagnoses entry_selectivity when win rate drops but avgRR holds', () => {
    const c = comparison(metric(40, 65, 'down'), metric(1.5, 1.4, 'flat'), metric(1.8, 2, 'flat'));
    const finding = diagnoseRootCause(c, profile(1), profile(1));
    expect(finding?.kind).toBe('entry_selectivity');
  });

  it('falls back to sample_variance when everything drops together with no distinguishing signal', () => {
    const c = comparison(metric(40, 65, 'down'), metric(1.0, 1.8, 'down'), metric(1.2, 2.5, 'down'));
    const finding = diagnoseRootCause(c, profile(1), profile(1));
    expect(finding?.kind).toBe('sample_variance');
  });

  it('returns null when the week actually improved', () => {
    const c = comparison(metric(80, 65, 'up'), metric(2, 1.4, 'up'), metric(3, 2, 'up'));
    expect(diagnoseRootCause(c, profile(1), profile(1))).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The sample floor
//
// The weekly report runs from 3 trades, which is fine for DESCRIBING a week
// and not close to enough for explaining one. Three trades against three moves
// every metric by large amounts on variance alone, and this function's output
// is a labelled mechanism that the narrative then explains to the trader in
// confident prose.
// ═══════════════════════════════════════════════════════════════════════════

describe('sample floor before naming a mechanism', () => {
  const thinWeek = { thisWeek: 4, prevWeek: 3 };
  const exitShaped = () => comparison(metric(70, 68, 'flat'), metric(1.2, 2.1, 'down'), metric(1.5, 2.5, 'down'));

  it('refuses to name exit management on a four-trade week', () => {
    expect(diagnoseRootCause(exitShaped(), profile(0.6), null)?.kind).toBe('exit_management');
    expect(diagnoseRootCause(exitShaped(), profile(0.6), null, thinWeek)?.kind).toBe('sample_variance');
  });

  it('names the mechanism once both weeks clear the floor', () => {
    expect(diagnoseRootCause(exitShaped(), profile(0.6), null, { thisWeek: 12, prevWeek: 10 })?.kind)
      .toBe('exit_management');
  });

  it('says nothing at all when a thin week did not move', () => {
    const flat = comparison(metric(70, 70, 'flat'), metric(1.2, 1.2, 'flat'), metric(2, 2, 'flat'));
    expect(diagnoseRootCause(flat, profile(0.6), null, thinWeek)).toBeNull();
  });
});
