import { describe, expect, it } from 'vitest';
import { computeTodaySignals } from '../../app/lib/coach-pipeline/analyzers/todaySignals';
import { buildRetrievalQuery } from '../../app/lib/coach-pipeline/retrieval/queryBuilder';
import {
  buildPastWritingItems,
  formatPastWritingBlock,
} from '../../app/lib/coach-pipeline/retrieval/pastWritingBlock';
import type { TradeRow, ChunkHit, NotebookEntryRow } from '../../app/lib/coach-pipeline/types';

// ── Fixture ─────────────────────────────────────────────────────────────────

let idCounter = 0;
function T(overrides: Partial<TradeRow> = {}): TradeRow {
  idCounter += 1;
  return {
    clerk_id:              'user_test',
    id:                    `t${idCounter}`,
    created_at:            '2026-08-15T09:00:00Z',
    updated_at:            '2026-08-15T09:00:00Z',
    deleted_at:            null,
    date:                  '2026-08-15',
    time:                  '10:00',
    symbol:                'ES',
    direction:             'LONG',
    contracts:             1,
    entry_price:           5000,
    stop_loss:             4990,
    take_profit:           5020,
    exit_price:            5020,
    exits:                 null,
    rr_planned:            2,
    r_multiple:            1,
    pnl_usd:               500,
    result:                'WIN',
    session:               'nyam',
    bias:                  null,
    setup:                 'SMT',
    confirmations:         null,
    emotional_state:       'CALM',
    followed_rules:        true,
    notes:                 '',
    tags:                  [],
    screenshots:           null,
    profile_processed_at:  null,
    profile_processed_rev: 0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// computeTodaySignals
// ═══════════════════════════════════════════════════════════════════════════

describe('computeTodaySignals — empty', () => {
  it('handles no trades', () => {
    const s = computeTodaySignals([]);
    expect(s.n_trades).toBe(0);
    expect(s.net_r).toBe(0);
    expect(s.best_r).toBeNull();
    expect(s.worst_r).toBeNull();
    expect(s.sessions).toEqual([]);
    expect(s.significance).toBe('no_trades');
  });

  it('ignores soft-deleted trades', () => {
    const trades = [T({ deleted_at: '2026-08-15T11:00:00Z' })];
    expect(computeTodaySignals(trades).n_trades).toBe(0);
  });
});

describe('computeTodaySignals — aggregates', () => {
  it('sums net_r across decided trades', () => {
    const trades = [
      T({ r_multiple:  2, result: 'WIN' }),
      T({ r_multiple: -1, result: 'LOSS' }),
      T({ r_multiple:  0, result: 'BE'   }),
    ];
    expect(computeTodaySignals(trades).net_r).toBe(1);
  });

  it('finds best_r and worst_r', () => {
    const trades = [
      T({ r_multiple: 0.5, result: 'WIN' }),
      T({ r_multiple: 2.3, result: 'WIN' }),
      T({ r_multiple: -1.5, result: 'LOSS' }),
    ];
    const s = computeTodaySignals(trades);
    expect(s.best_r).toBe(2.3);
    expect(s.worst_r).toBe(-1.5);
  });

  it('counts rules violated only for decided trades', () => {
    const trades = [
      T({ followed_rules: false, result: 'LOSS' }),
      T({ followed_rules: false, result: 'OPEN' }),   // not decided → not counted
      T({ followed_rules: true,  result: 'WIN'  }),
    ];
    expect(computeTodaySignals(trades).rules_violated).toBe(1);
  });
});

describe('computeTodaySignals — unique lists preserve order', () => {
  it('lists sessions/setups/emotions in first-occurrence order', () => {
    const trades = [
      T({ session: 'london', setup: 'SMT', emotional_state: 'CALM' }),
      T({ session: 'nyam',   setup: 'FVG', emotional_state: 'FOMO' }),
      T({ session: 'london', setup: 'SMT', emotional_state: 'CALM' }),
    ];
    const s = computeTodaySignals(trades);
    expect(s.sessions).toEqual(['london', 'nyam']);
    expect(s.setups).toEqual(['SMT', 'FVG']);
    expect(s.emotions).toEqual(['CALM', 'FOMO']);
  });

  it('drops nulls silently', () => {
    const trades = [
      T({ session: null, setup: null, emotional_state: null }),
    ];
    const s = computeTodaySignals(trades);
    expect(s.sessions).toEqual([]);
    expect(s.setups).toEqual([]);
    expect(s.emotions).toEqual([]);
  });
});

describe('computeTodaySignals — significance', () => {
  it('red_day when net_r < -1', () => {
    expect(computeTodaySignals([T({ r_multiple: -2, result: 'LOSS' })]).significance).toBe('red_day');
  });

  it('green_day when net_r > 1', () => {
    expect(computeTodaySignals([T({ r_multiple: 2, result: 'WIN' })]).significance).toBe('green_day');
  });

  it('normal when |net_r| <= 1', () => {
    expect(computeTodaySignals([T({ r_multiple: 0.5, result: 'WIN' })]).significance).toBe('normal');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildRetrievalQuery
// ═══════════════════════════════════════════════════════════════════════════

describe('buildRetrievalQuery — normal day', () => {
  it('includes n_trades, net_r, setups, sessions, emotions, significance', () => {
    const trades = [
      T({ setup: 'SMT', session: 'london', emotional_state: 'CALM', r_multiple: 1, result: 'WIN' }),
      T({ setup: 'FVG', session: 'nyam',   emotional_state: 'FOMO', r_multiple: -1, result: 'LOSS' }),
    ];
    const q = buildRetrievalQuery(computeTodaySignals(trades));
    expect(q).toContain('2 עסקאות');
    expect(q).toContain('SMT');
    expect(q).toContain('london');
    expect(q).toContain('FOMO');
  });

  it('marks a no-trade day distinctly', () => {
    const q = buildRetrievalQuery(computeTodaySignals([]));
    expect(q).toContain('אין עסקאות');
    expect(q).toContain('יום ללא מסחר');
  });

  it('surfaces rule violations only when there are some', () => {
    const clean = [T({ r_multiple: 1, result: 'WIN', followed_rules: true })];
    const dirty = [T({ r_multiple: -1, result: 'LOSS', followed_rules: false })];
    expect(buildRetrievalQuery(computeTodaySignals(clean))).not.toContain('הפרות');
    expect(buildRetrievalQuery(computeTodaySignals(dirty))).toContain('1 הפרות חוקים');
  });

  it('signs the net R clearly', () => {
    const win  = [T({ r_multiple: 2, result: 'WIN'  })];
    const loss = [T({ r_multiple: -1.5, result: 'LOSS' })];
    expect(buildRetrievalQuery(computeTodaySignals(win))).toContain('+2.0R');
    expect(buildRetrievalQuery(computeTodaySignals(loss))).toContain('-1.5R');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildPastWritingItems + formatPastWritingBlock
// ═══════════════════════════════════════════════════════════════════════════

function chunk(overrides: Partial<ChunkHit> = {}): ChunkHit {
  return {
    clerk_id:    'user_test',
    id:          'c1',
    entry_id:    'e1',
    chunk_ix:    0,
    content:     'Some notebook content about SMT setups.',
    token_count: 10,
    embedding:   [0.1],
    created_at:  '2026-08-01T00:00:00Z',
    score:       0.82,
    ...overrides,
  };
}

function entryMeta(kind: NotebookEntryRow['kind'] = 'journal', created = '2026-08-01T00:00:00Z') {
  return { created_at: created, kind };
}

describe('buildPastWritingItems', () => {
  it('joins chunks with their entry metadata', () => {
    const hits = [chunk({ id: 'c1', entry_id: 'e1' })];
    const map = new Map([['e1', entryMeta('journal', '2026-08-01T00:00:00Z')]]);
    const items = buildPastWritingItems(hits, map);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      date: '2026-08-01',
      kind: 'journal',
      score: 0.82,
    });
    expect(items[0].snippet).toBe('Some notebook content about SMT setups.');
  });

  it('rounds score to 2 decimals', () => {
    const hits = [chunk({ score: 0.87654 })];
    const map  = new Map([['e1', entryMeta()]]);
    expect(buildPastWritingItems(hits, map)[0].score).toBe(0.88);
  });

  it('defaults kind to "note" when entry missing (defensive)', () => {
    const hits = [chunk({ entry_id: 'unknown' })];
    const items = buildPastWritingItems(hits, new Map());
    expect(items[0].kind).toBe('note');
    expect(items[0].date).toBe('');
  });

  it('drops items with empty snippets', () => {
    const hits = [chunk({ content: '   \n  ' })];
    const map  = new Map([['e1', entryMeta()]]);
    expect(buildPastWritingItems(hits, map)).toHaveLength(0);
  });

  it('preserves the order given by the hits', () => {
    const hits = [
      chunk({ id: 'a', entry_id: 'e1', content: 'first',  score: 0.9 }),
      chunk({ id: 'b', entry_id: 'e1', content: 'second', score: 0.8 }),
      chunk({ id: 'c', entry_id: 'e1', content: 'third',  score: 0.7 }),
    ];
    const map = new Map([['e1', entryMeta()]]);
    const items = buildPastWritingItems(hits, map);
    expect(items.map(i => i.snippet)).toEqual(['first', 'second', 'third']);
  });
});

describe('formatPastWritingBlock', () => {
  it('produces valid JSON', () => {
    const items = [{ date: '2026-08-01', snippet: 'x', kind: 'note' as const, score: 0.9 }];
    const block = formatPastWritingBlock(items);
    expect(() => JSON.parse(block)).not.toThrow();
  });

  it('empty items produces empty JSON array', () => {
    expect(formatPastWritingBlock([])).toBe('[]');
  });

  it('is pretty-printed (contains newlines for readability)', () => {
    const items = [
      { date: '2026-08-01', snippet: 'x', kind: 'note' as const, score: 0.9 },
      { date: '2026-08-02', snippet: 'y', kind: 'plan' as const, score: 0.8 },
    ];
    expect(formatPastWritingBlock(items)).toContain('\n');
  });
});
