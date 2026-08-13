// ─────────────────────────────────────────────────────────────────────────────
// The whole chain, on one trade.
//
// Every other test in the repo checks one link. This one walks a single trade
// through all of them in the order the real app does — the form's output, the
// validation, the row that goes to the database, the row that comes back, the
// mirror into the analysis tables, the detectors, the readiness panel and the
// verification checks.
//
// It exists because every silent failure this session was a JOINT and not a
// component. followedRules was dropped by validation between two correct
// modules. exits were collected and never asked for. The confirmations field
// was read as evidence before it was ever used. In all three cases the units
// passed and the chain was broken, which is the specific thing a chain test
// catches and nothing else does.
//
// It prints the value at each step. When something breaks here, the failing
// assertion names the link.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { tradeEntrySchema } from '../../app/lib/validation';
import { rowToTrade, tradeToRow, type TradeRow as JournalRow } from '../../app/api/journal/route';
import { tradeEntryToIntelligenceRow } from '../../app/lib/coach-pipeline/mirror/journalToIntelligence';
import { detectBehaviors } from '../../app/lib/coach-pipeline/behavior/behaviors';
import { computeReadiness } from '../../app/lib/coach-pipeline/behavior/readiness';
import { verifyTrade } from '../../app/lib/trade/verification';
import { analyzeStopMoves } from '../../app/lib/trade/management';
import type { TradeEntry } from '../../app/lib/journal';
import type { TradeRow } from '../../app/lib/coach-pipeline/types';

/** What TradeForm.performSave builds for a fully-filled MNQ long: entered at
 *  29,840 with a 30-point stop and a 90-point target, stop advanced twice
 *  while it ran, closed by hand at 29,890 — short of the target. Rules
 *  answered, confirmations tagged. */
const fromForm = {
  id: 1_760_000_000_000,
  dateISO: '2026-08-13',
  time: '16:42',
  symbol: 'MNQ' as const,
  contracts: 2,
  direction: 'LONG' as const,
  entry: 29840,
  stop:  29810,
  target: 29930,
  session: 'NYAM',
  bias: 'BULLISH' as const,
  model: 'Silver Bullet',
  result: 'WIN' as const,
  notes: 'IFVG אחרי סוויפ של הלואו',
  exits: [{ price: 29890, contracts: 2 }],
  confirmations: ['IFVG', 'SMT'],
  emotionalState: 'CALM' as const,
  followedRules: true,
  stopMoved: 'advanced' as const,
  management: [
    { at: '2026-08-13T13:48:00.000Z', kind: 'stop' as const, to: 29840 },
    { at: '2026-08-13T13:55:00.000Z', kind: 'stop' as const, to: 29865 },
  ],
  tradeR: 1.67,
  pnlUsd: 200,
};

describe('one trade, every link', () => {
  it('survives validation with every field the analysis needs', () => {
    const parsed = tradeEntrySchema.parse(fromForm);
    // The three fields that were silently dropped at this exact point before.
    expect(parsed.followedRules).toBe(true);
    expect(parsed.stopMoved).toBe('advanced');
    expect(parsed.exits).toHaveLength(1);
    expect(parsed.management).toHaveLength(2);
  });

  it('round-trips through the journal row', () => {
    const parsed = tradeEntrySchema.parse(fromForm) as TradeEntry;
    const row  = tradeToRow('user_1', parsed);
    const back = rowToTrade(row as JournalRow);

    expect(row.stop_moved).toBe('advanced');
    expect(row.management).toHaveLength(2);
    expect(back.followedRules).toBe(true);
    expect(back.exits?.[0].price).toBe(29890);
  });

  it('reaches the analysis tables with a MEASURED exit, not an assumed one', () => {
    const parsed = tradeEntrySchema.parse(fromForm) as TradeEntry;
    const m = tradeEntryToIntelligenceRow('user_1', parsed);

    expect(m.exit_price).toBe(29890);      // weighted from the legs
    expect(m.take_profit).toBe(29930);     // the plan, kept apart from it
    expect(m.followed_rules).toBe(true);
    expect(m.stop_moved).toBe('advanced');
    expect(m.management).toHaveLength(2);
  });

  it('is read by the detectors as a departure from the plan, despite being a win', () => {
    const parsed = tradeEntrySchema.parse(fromForm) as TradeEntry;
    const m = tradeEntryToIntelligenceRow('user_1', parsed);
    const row = {
      ...m,
      created_at: '2026-08-13T13:42:00.000Z',
      profile_processed_at: null, profile_processed_rev: 0,
    } as unknown as TradeRow;

    const tallies = detectBehaviors([row]);
    const byKind = Object.fromEntries(tallies.map(t => [t.kind, t]));

    // Exited at 29,890 — 55% of the way to a 29,930 target. A win, and a
    // decision taken mid-trade all the same.
    expect(byKind.discretionary_exit.occurrences).toBe(1);
    expect(byKind.discretionary_exit.events[0].evidence.progress_to_target).toBeCloseTo(0.56, 1);

    // Answered, and clean.
    expect(byKind.rule_violation.opportunities).toBe(1);
    expect(byKind.rule_violation.occurrences).toBe(0);

    // The stop moved twice, both toward entry. Read from the log, not the
    // answer — and the evidence says which.
    expect(byKind.stop_widened.opportunities).toBe(1);
    expect(byKind.stop_widened.occurrences).toBe(0);
    expect(analyzeStopMoves(29810, 'LONG', fromForm.management)).toMatchObject({
      verdict: 'advanced', advanced: 2, widened: 0,
    });
  });

  it('moves four of the five readiness counters off zero', () => {
    const parsed = tradeEntrySchema.parse(fromForm) as TradeEntry;
    const m = tradeEntryToIntelligenceRow('user_1', parsed);
    const row = { ...m, created_at: '', profile_processed_at: null, profile_processed_rev: 0 } as unknown as TradeRow;

    const r = computeReadiness([row]);
    const have = Object.fromEntries(r.detectors.map(d => [d.kind, d.have]));

    expect(have.discretionary_exit).toBe(1);
    expect(have.rule_violation).toBe(1);
    expect(have.no_confirmation).toBe(1);
    expect(have.stop_widened).toBe(1);
    // size_spike needs five prior trades before "usual size" exists.
    expect(have.size_spike).toBe(0);
    expect(r.tradesDecided).toBe(1);
  });

  it('passes every verification check — nothing contradicts anything', () => {
    const checks = verifyTrade({
      direction: 'LONG', entry: 29840, stop: 29810, target: 29930,
      contracts: 2, result: 'WIN',
      exits: fromForm.exits, stopMoved: 'advanced', management: fromForm.management,
    });
    expect(checks.filter(c => c.status === 'disagrees')).toEqual([]);
    // All three are checkable on a trade this complete.
    expect(checks.filter(c => c.status === 'agrees')).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The same trade, mistyped the way the live data actually was.
// ─────────────────────────────────────────────────────────────────────────────

describe('the failure modes it is supposed to catch', () => {
  it('flags the BE-marked trade whose exits say a full winner', () => {
    const checks = verifyTrade({
      direction: 'LONG', entry: 29840, stop: 29810, target: 29930,
      contracts: 2, result: 'BE',
      exits: [{ price: 29930, contracts: 2 }],
    });
    const c = checks.find(x => x.id === 'result_vs_exit')!;
    expect(c.status).toBe('disagrees');
    expect(c.reported).toBe('ברייק איוון');
    expect(c.recorded).toBe('טייק');
  });

  it('flags "I did not touch the stop" against a log that says otherwise', () => {
    const checks = verifyTrade({
      direction: 'LONG', entry: 29840, stop: 29810, target: 29930,
      contracts: 2, result: 'LOSS',
      exits: [{ price: 29780, contracts: 2 }],
      stopMoved: 'none',
      management: [{ at: '2026-08-13T13:50:00.000Z', kind: 'stop', to: 29780 }],
    });
    expect(checks.find(x => x.id === 'stop_moved_vs_log')!.status).toBe('disagrees');
  });

  it('leaves a trade logged with nothing extra completely invisible, not clean', () => {
    const bare = tradeEntrySchema.parse({
      ...fromForm,
      exits: undefined, confirmations: undefined,
      followedRules: undefined, stopMoved: undefined, management: undefined,
    }) as TradeEntry;
    const m = tradeEntryToIntelligenceRow('user_1', bare);
    const row = { ...m, created_at: '', profile_processed_at: null, profile_processed_rev: 0 } as unknown as TradeRow;

    const kinds = detectBehaviors([row]).map(t => t.kind);
    // No exit, no rules answer, no stop answer, and confirmations never used —
    // four detectors with nothing to see. Reporting 0 of 0 would read as praise.
    expect(kinds).not.toContain('discretionary_exit');
    expect(kinds).not.toContain('rule_violation');
    expect(kinds).not.toContain('stop_widened');
    expect(kinds).not.toContain('no_confirmation');
  });
});
