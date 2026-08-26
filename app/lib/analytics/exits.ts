import type { TradeEntry } from '../journal';
import { calcRR, calcMultiExitRealizedR } from '../calc/trade';
import type { ExitBehavior } from './types';

/** A winner that realized less than this fraction of its own planned R is
    counted as "cut short" — meaningful money left on the table vs the plan. */
const CUT_SHORT_THRESHOLD = 0.6;

const EMPTY: ExitBehavior = {
  sampleSize: 0,
  winnerCount: 0,
  captureRatio: null,
  winnersCutShort: 0,
  partialExitRate: 0,
  avgWinnerR: 0,
  avgLoserR: 0,
};

const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/** Pure exit-management analysis over the trades that actually carry recorded
    exit legs. Answers "am I cutting winners short vs my own plan, and do I
    scale out?" — the raw material for exit-behavior insights. Only looks at
    closed trades with `exits[]`, so it never fabricates a signal from
    pre-multi-exit records. */
export function analyzeExits(trades: TradeEntry[]): ExitBehavior {
  const sample = trades.filter(t => t.result !== 'OPEN' && (t.exits?.length ?? 0) > 0);
  if (sample.length === 0) return EMPTY;

  let partialCount = 0;
  let winnersCutShort = 0;
  let sumWinnerRealized = 0;
  let sumWinnerPlanned = 0;
  const winnerRs: number[] = [];
  const loserRs: number[] = [];

  for (const t of sample) {
    const exits = t.exits!;
    if (exits.length > 1) partialCount++;

    const realizedR = calcMultiExitRealizedR(t.entry, t.stop, exits, t.direction);
    if (realizedR === null) continue;

    if (t.result === 'WIN') {
      winnerRs.push(realizedR);
      const plannedR = calcRR(t.entry, t.stop, t.target, t.direction);
      if (plannedR !== null && plannedR > 0) {
        sumWinnerRealized += realizedR;
        sumWinnerPlanned += plannedR;
        if (realizedR < CUT_SHORT_THRESHOLD * plannedR) winnersCutShort++;
      }
    } else if (t.result === 'LOSS') {
      loserRs.push(realizedR);
    }
  }

  return {
    sampleSize: sample.length,
    winnerCount: winnerRs.length,
    captureRatio: sumWinnerPlanned > 0 ? sumWinnerRealized / sumWinnerPlanned : null,
    winnersCutShort,
    partialExitRate: partialCount / sample.length,
    avgWinnerR: mean(winnerRs),
    avgLoserR: mean(loserRs),
  };
}
