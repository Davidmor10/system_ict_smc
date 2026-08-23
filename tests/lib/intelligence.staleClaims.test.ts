// ─────────────────────────────────────────────────────────────────────────────
// "Why does it say 19 trades when I deleted them and have 3?"
//
// Two independent faults produced that sentence, and this file pins both:
//
//   1. The refresh was gated on the closed-trade count differing from the one
//      the stored profile was built from. That number agrees again the moment
//      a refresh runs, so the pattern rows froze exactly as that run left them
//      — including rows mid grace-period, still carrying the sample size and
//      win rate of trades that had since been deleted.
//   2. A pattern the current run did not find kept its 'active' status, and
//      every consumer reads active/strengthening as "true of this trader now".
//
// The last assertion is the floor under both: a claim may never rest on more
// trades than the trader has. That is arithmetic, not judgement.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabaseClient } from '../helpers/fakeSupabase';
import { makeTrade } from '../helpers/trade';
import type { TradeEntry } from '../../app/lib/journal';

const fakeDb = new FakeSupabaseClient();

vi.mock('../../app/lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  createServerSupabaseClient: () => fakeDb,
}));

// The phrasing layer echoes the sample size it was handed, so an assertion on
// the returned text is an assertion on the number the pipeline believed.
vi.mock('../../app/lib/ai/insightPhrasing', () => ({
  generateHypothesisPhrasing: vi.fn(async () => ({ description: 'hypothesis', evidence: 'evidence' })),
  generatePatternPhrasing: vi.fn(async () => ({ title: 'pattern', evidence: 'evidence', action: 'watch' })),
  generateWorkingStrengthsPhrasing: vi.fn(async () => null),
  generateInsightsPhrasing: vi.fn(async (inputs: Array<{ metric: { trades: number; confidence: { sampleSize: number } } }>) =>
    inputs.map(i => `built on ${Math.max(i.metric.trades, i.metric.confidence.sampleSize)} trades`)),
  metricsEvidence: (metrics: Record<string, { trades?: number }>) => `מבוסס על ${Object.values(metrics)[0]?.trades ?? 0} עסקאות.`,
}));

const service = await import('../../app/lib/intelligence/service');

const CLERK = 'user_stale';

function row(t: TradeEntry, deleted = false) {
  return {
    id: t.id, clerk_id: CLERK, date_iso: t.dateISO, time_val: t.time, symbol: t.symbol, contracts: t.contracts,
    direction: t.direction, entry: t.entry, stop_price: t.stop, target: t.target, session: t.session, bias: t.bias,
    model: t.model, result: t.result, notes: t.notes, account_id: null, setup: null, confirmation: null,
    bias_alignment: null, trade_r: null, pnl_usd: null, screenshots: null,
    deleted_at: deleted ? '2026-08-23T09:00:00.000Z' : null,
  };
}

/** A history with a real, separable edge — one session wins, another loses —
 *  so discoverPatterns has something significant to find. */
function history(): TradeEntry[] {
  return [
    ...Array.from({ length: 12 }, () => makeTrade({ symbol: 'ES', session: 'nyam', result: 'WIN', entry: 100, stop: 99, target: 103 })),
    ...Array.from({ length: 12 }, () => makeTrade({ symbol: 'ES', session: 'asia', result: 'LOSS', entry: 100, stop: 99, target: 103 })),
  ];
}

/** Puts the account in the state the bug reports came from: a real, settled
 *  profile built from the three trades that actually exist, and a pattern row
 *  left over from when there were nineteen. The counts agree, which is exactly
 *  why the stale row used to be read straight back out and quoted. */
async function settleThenFreeze(patternRow: Record<string, unknown>) {
  fakeDb.seed('journal_trades', threeTrades().map(t => row(t)));
  await service.generatePersonalizedInsights(CLERK, 'he');
  fakeDb.tables['pattern_memory'] = [patternRow];
}

function claimedNumbers(texts: string[]): number[] {
  return texts.flatMap(t => [...t.matchAll(/built on (\d+) trades/g)].map(m => Number(m[1])));
}

beforeEach(() => { fakeDb.tables = {}; });

/** A pattern_memory row exactly as an earlier run left it: found back when the
 *  trader had 19 trades, still marked active, still carrying that sample. This
 *  is the state the bug reports came from — the trades behind it are gone, the
 *  row is not. */
function frozenPatternRow(sampleSize: number) {
  const at = '2026-08-01T00:00:00.000Z';
  return {
    clerk_id: CLERK,
    pattern_id: 'ES_nyam',
    kind: 'instrument+session',
    subject: { instrument: 'ES', session: 'nyam' },
    status: 'active',
    current_metric: {
      key: 'ES_nyam', label: 'ES · NYAM', trades: sampleSize, wins: 16, losses: 3,
      winRate: 82, totalPnl: 1516, avgRR: 0.65, avgWinner: 120, avgLoser: 40, profitFactor: 3.02,
      confidence: { level: 'medium', sampleSize },
    },
    current_confidence_level: 'medium',
    current_sample_size: sampleSize,
    baseline_win_rate: 50,
    delta: 32,
    first_detected_at: at, last_seen_at: at, last_updated_at: at,
    consecutive_misses: 0,
    history: [{ at, winRate: 82, delta: 32, confidenceLevel: 'medium', sampleSize, status: 'active' }],
    ai_title: null, ai_evidence: null, ai_action: null, ai_phrased_status: null, ai_phrased_win_rate: null,
    created_at: at,
  };
}

/** Three trades — nothing a discovery run can build a 19-trade claim from. */
function threeTrades(): TradeEntry[] {
  return Array.from({ length: 3 }, () => makeTrade({ symbol: 'ES', session: 'nyam', result: 'WIN', entry: 100, stop: 99, target: 103 }));
}

describe('an insight can never outlive the trades behind it', () => {
  it('does not quote a 19-trade pattern to a trader holding three', async () => {
    await settleThenFreeze(frozenPatternRow(19));

    const { insights } = await service.generatePersonalizedInsights(CLERK, 'he');

    for (const n of claimedNumbers(insights.map(i => i.text))) {
      expect(n).toBeLessThanOrEqual(3);
    }
    expect(insights.map(i => i.text).join(' ')).not.toContain('19');
  });

  it('the dashboard insight is held to the same floor', async () => {
    await settleThenFreeze(frozenPatternRow(19));

    const insight = await service.generateDashboardPrimaryInsight(CLERK, 'he');
    if (insight) expect(insight.sampleSize).toBeLessThanOrEqual(3);
  });

  it('rewrites a rediscovered pattern down to its real sample instead of keeping the old one', async () => {
    await settleThenFreeze(frozenPatternRow(19));

    await service.generatePersonalizedInsights(CLERK, 'he');

    const stored = fakeDb.getAll('pattern_memory').find(r => r.pattern_id === 'ES_nyam');
    expect(stored?.current_sample_size).toBeLessThanOrEqual(3);
    expect(stored?.status).not.toBe('active');
  });

  it('a pattern the current run did NOT find stops counting as live evidence', async () => {
    // Its subject is nowhere in the journal, so discovery cannot return it —
    // the row can only be carried forward, which is the case that used to keep
    // an 'active' status and go on being quoted.
    const orphan = { ...frozenPatternRow(19), pattern_id: 'NQ_london', subject: { instrument: 'NQ', session: 'london' } };
    await settleThenFreeze(orphan);

    await service.generatePersonalizedInsights(CLERK, 'he');

    const stored = fakeDb.getAll('pattern_memory').find(r => r.pattern_id === 'NQ_london');
    expect(stored?.consecutive_misses).toBe(1);
    expect(stored?.status).not.toBe('active');
    expect(stored?.status).not.toBe('strengthening');
  });

  it('rebuilds even when the closed-trade count happens to match the stored one', async () => {
    // The exact shape that froze: refresh once so the profile records the
    // count, then swap the trades for a DIFFERENT set of the same size. The
    // old gate saw equal counts and served the previous run's rows forever.
    const first = history();
    fakeDb.seed('journal_trades', first.map(t => row(t)));
    await service.generatePersonalizedInsights(CLERK, 'he');

    const replacement = [
      ...Array.from({ length: 12 }, () => makeTrade({ symbol: 'NQ', session: 'london', result: 'WIN', entry: 100, stop: 99, target: 103 })),
      ...Array.from({ length: 12 }, () => makeTrade({ symbol: 'NQ', session: 'nypm', result: 'LOSS', entry: 100, stop: 99, target: 103 })),
    ];
    fakeDb.tables['journal_trades'] = replacement.map(t => row(t));

    const after = await service.generatePersonalizedInsights(CLERK, 'he');
    expect(after.insights.map(i => i.subject).join(' ')).not.toMatch(/ES/);
  });

  it('says nothing rather than something false when every claim is stale', async () => {
    const trades = history();
    fakeDb.seed('journal_trades', trades.map(t => row(t)));
    await service.generatePersonalizedInsights(CLERK, 'he');

    // Every trade gone. Silence is the only honest output.
    fakeDb.tables['journal_trades'] = trades.map(t => row(t, true));

    const after = await service.generatePersonalizedInsights(CLERK, 'he');
    expect(after.insights).toEqual([]);
  });
});
