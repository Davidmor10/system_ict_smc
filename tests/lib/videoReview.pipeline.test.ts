import { describe, it, expect, vi } from 'vitest';
import { runReviewPipelineWith, type PipelineStages } from '../../app/lib/videoReview/pipeline';
import type { TradeReviewRow, TraderContext, VisionAnalysis, Transcript, TradeReviewReport } from '../../app/lib/videoReview/types';

function fakeRow(overrides: Partial<TradeReviewRow> = {}): TradeReviewRow {
  return {
    id: 'r-1', clerkId: 'u-1', tradeId: 42,
    status: 'analyzing',
    videoFileUri: 'files/abc', videoMime: 'video/mp4',
    createdAt: 1, updatedAt: 1,
    ...overrides,
  };
}
function fakeCtx(): TraderContext {
  return {
    trade: { id: 42, symbol: 'ES', direction: 'LONG', entry: 5000, stop: 4995, target: 5015, result: 'WIN', contracts: 1, session: 'nyam', dateISO: '2026-08-01', time: '10:00' },
    rules: [], setups: [],
    recentStats: { winRate30d: null, avgR30d: null, tradesCount30d: 0, profitableSessions: [] },
    patterns: [],
  };
}
const emptyVision: VisionAnalysis = { marketStructure: { bosDetected: [], chochDetected: [] }, liquidity: { sweeps: [], pools: [] }, imbalances: { fvgs: [] }, entry: null, stop: null, target: null, pointingMoments: [], notes: '' };
const emptyTranscript: Transcript = { full: '', segments: [], language: 'he' };
const emptyReport: TradeReviewReport = {
  whatHappened: [], decisionVerdict: { verdict: 'unclear', reasoning: '', confidence: 'low', evidence: [] },
  mistakes: [], goodDecisions: [], rulesBroken: [], recurringPatterns: [],
  overallConfidence: 'low', alternativeReadings: [],
  oneThingToImprove: { habit: '', whyThisOne: '', howToPractice: '', evidence: [] },
};

function makeStore(row: TradeReviewRow | null) {
  const updates: Partial<TradeReviewRow>[] = [];
  return {
    updates,
    get: vi.fn(async () => row),
    update: vi.fn(async (_id: string, patch: Partial<TradeReviewRow>) => { updates.push(patch); }),
  };
}
function makeStages(over: Partial<PipelineStages> = {}): PipelineStages {
  return {
    buildContext: vi.fn(async () => fakeCtx()),
    vision: vi.fn(async () => emptyVision),
    transcript: vi.fn(async () => emptyTranscript),
    report: vi.fn(async () => emptyReport),
    memory: vi.fn(async () => {}),
    ...over,
  };
}

describe('runReviewPipelineWith', () => {
  it('runs all stages and marks status=done', async () => {
    const store = makeStore(fakeRow());
    const stages = makeStages();
    await runReviewPipelineWith('r-1', 'u-1', stages, store);

    expect(stages.vision).toHaveBeenCalledWith('files/abc', 'video/mp4');
    expect(stages.transcript).toHaveBeenCalledWith('files/abc', 'video/mp4');
    expect(stages.report).toHaveBeenCalledTimes(1);
    // Two updates expected: intermediate (vision+transcript) then final (report+status=done)
    expect(store.updates).toHaveLength(2);
    expect(store.updates[1].status).toBe('done');
    expect(store.updates[1].report).toBe(emptyReport);
  });

  it('marks status=failed with message when context cannot be built', async () => {
    const store = makeStore(fakeRow());
    const stages = makeStages({ buildContext: vi.fn(async () => null) });
    await runReviewPipelineWith('r-1', 'u-1', stages, store);
    const last = store.updates.at(-1)!;
    expect(last.status).toBe('failed');
    expect(last.errorMessage).toContain('no context');
  });

  it('marks status=failed when vision throws', async () => {
    const store = makeStore(fakeRow());
    const stages = makeStages({ vision: vi.fn(async () => { throw new Error('vision boom'); }) });
    await runReviewPipelineWith('r-1', 'u-1', stages, store);
    const last = store.updates.at(-1)!;
    expect(last.status).toBe('failed');
    expect(last.errorMessage).toContain('vision boom');
  });

  it('marks failed when the review row is missing', async () => {
    const store = makeStore(null);
    const stages = makeStages();
    await runReviewPipelineWith('r-1', 'u-1', stages, store);
    expect(store.updates.at(-1)!.status).toBe('failed');
    expect(stages.vision).not.toHaveBeenCalled();
  });

  it('does not fail the pipeline when memory update throws', async () => {
    const store = makeStore(fakeRow());
    const stages = makeStages({ memory: vi.fn(async () => { throw new Error('mem down'); }) });
    await runReviewPipelineWith('r-1', 'u-1', stages, store);
    // pipeline still reports success — memory is best-effort
    expect(store.updates.at(-1)!.status).toBe('done');
  });
});
