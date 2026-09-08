// The AI paragraph a thin week is allowed to have.
//
// The request: "I want the AI to give an insight about the 4 trades I took
// this week, and connect it to the user in general."
//
// The tension it has to survive: 4 trades cannot establish anything, and the
// whole reason the full weekly report has a floor is that a letter written off
// 4 trades invents a mechanism. But 4 trades CAN be recognised — whether they
// look like this trader's ordinary week is a comparison against a large
// sample, and the large sample is the journal, not the week.
//
// So the prompt is built around that distinction, and the report does not
// depend on the answer arriving: the counts are written either way.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { factualWeeklyReport } from '../../app/lib/intelligence/weeklyFactual';
import type { TradeEntry } from '../../app/lib/journal';

const narrative = readFileSync('app/lib/ai/weeklyNarrative.ts', 'utf8');
const service   = readFileSync('app/lib/intelligence/service.ts', 'utf8');
const panel     = readFileSync('app/components/WeeklyReportPanel.tsx', 'utf8');

const t = (o: Partial<TradeEntry>): TradeEntry => ({
  id: 1, dateISO: '2026-09-02', time: '16:30', symbol: 'MNQ', contracts: 1,
  direction: 'LONG', entry: 1, stop: 1, target: 1, session: 'nyam',
  model: 'Silver Bullet', result: 'WIN', notes: '', tradeR: 2, pnlUsd: 1, ...o,
} as TradeEntry);

describe('what the factual report hands the model', () => {
  const week = [t({ result: 'WIN', tradeR: 2 }), t({ result: 'LOSS', tradeR: -1 }), t({ result: 'BE', tradeR: 0 })];
  const r = factualWeeklyReport({
    weekTrades: week, prevWeekTrades: [], journalTrades: week, daysIn: 4, claimFloor: 5,
  });

  it('hands over the same lines the trader reads, not a second rendering', () => {
    // Two renderings of the same trades can disagree, and the one the model
    // cites would then not be the one on screen.
    expect(r.tradeLines).toHaveLength(3);
    expect(r.paragraphs.join('\n')).toContain(r.tradeLines[0]);
    expect(r.paragraphs.join('\n')).toContain(r.weekSummary);
  });

  it('hands over the decided count, not the closed one', () => {
    // A break-even decides nothing, and the model must argue from the real
    // number rather than from a vague "few".
    expect(r.decided).toBe(2);
  });
});

describe('the fence in the prompt', () => {
  it('names the trade count so the limit is concrete', () => {
    expect(narrative).toContain('${facts.decidedThisWeek} decided trades this week');
  });

  it('forbids exactly the claims the floor exists to prevent', () => {
    for (const forbidden of [
      'That this week shows a trend, an improvement, or a deterioration',
      'That anything CAUSED this week',
      'has, or has lost, an edge',
      'No win rate for the week',
    ]) {
      expect(narrative).toContain(forbidden);
    }
  });

  it('points the comparison at the journal, not at the week', () => {
    expect(narrative).toContain('the only sample here large enough to be a reference point');
    expect(narrative).toContain('look like the trader\'s ordinary behaviour');
  });

  it('makes "nothing to add" an allowed answer', () => {
    // Otherwise the model manufactures a connection, which on four trades is
    // exactly the failure the whole design is avoiding.
    expect(narrative).toContain('Saying nothing was found is a legitimate answer');
  });

  it('drops a violating draft instead of arguing with it', () => {
    // The weekly letter gets one corrective retry because a letter is the
    // whole product. This paragraph is an addition to a complete report, so a
    // platitude is dropped — a thin week is where one does the most damage.
    expect(narrative).toContain('thin-week observation violated its own rules, dropped');
    expect(narrative).toContain('There is no retry');
  });
});

describe('the report does not depend on it', () => {
  it('goes out unchanged when the model returns nothing', () => {
    expect(service).toContain('let observation: string[] | null = null;');
    expect(service).toContain(': factual.paragraphs;');
  });

  it('does not even ask on a week with nothing decided', () => {
    expect(service).toContain('if (factual.decided > 0)');
  });

  it('reads stored rows rather than triggering a full refresh', () => {
    // A quiet week must not cost what a full week costs.
    expect(service).toContain('repo.getTraderProfile(supabase, userId, scope)');
    expect(service).toContain('repo.getPatternMemory(supabase, userId, scope)');
    const thin = service.slice(service.indexOf('if (closedThisWeek.length < MIN_TRADES_FOR_WEEKLY_CLAIMS)'), service.indexOf('// Avoid redundant LLM spend') + 1 || undefined);
    expect(thin).not.toContain('refreshIntelligence');
  });

  it('keeps the limits paragraph last, where the panel renders the takeaway', () => {
    // On a week like this the takeaway IS the limit, not the observation.
    expect(service).toContain('factual.paragraphs.slice(0, -1)');
    expect(service).toContain('factual.paragraphs[factual.paragraphs.length - 1]');
  });
});

describe('the label on screen', () => {
  it('never says AI over a report no model touched', () => {
    expect(panel).toContain('report.aiWritten');
    expect(panel).toContain("'WEEKLY RECORD · AI NOTE'");
    expect(panel).toContain("'WEEKLY RECORD'");
  });

  it('carries the flag rather than guessing it from the trade count', () => {
    expect(service).toContain('aiWritten: observation != null');
    expect(service).toContain('aiWritten: true');
  });
});
