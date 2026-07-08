import type { FullAnalysis, GroupPerformance } from '../analytics';
import type { KnownFact, PatternMemoryRow, PeriodComparison, RootCauseFinding } from '../intelligence/types';

/** Infinity (all wins, zero losses) can't survive JSON.stringify or a prompt
    string as a number — always route profit factor through this. */
export function fmtPF(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '∞';
}

function fmtGroup(g: GroupPerformance): string {
  return `${g.label}: ${g.trades} trades, ${g.wins}W/${g.losses}L, winRate ${g.winRate.toFixed(0)}%, PnL $${g.totalPnl.toFixed(0)}, avgRR ${g.avgRR.toFixed(2)}, avgWinner $${g.avgWinner.toFixed(0)}, avgLoser $${g.avgLoser.toFixed(0)}, PF ${fmtPF(g.profitFactor)}, confidence ${g.confidence.level} (n=${g.confidence.sampleSize})`;
}

/** Renders a FullAnalysis into a compact, numbers-only text block for an LLM
    prompt. This — never the raw trade array — is what the model is allowed
    to see, so it has no way to invent a fact that isn't already computed. */
export function summarizeAnalysis(a: FullAnalysis): string {
  const p = a.performance;
  const lines: string[] = [];

  lines.push(
    `OVERALL: ${p.totalTrades} trades (${p.closedTrades} closed), winRate ${p.winRate.toFixed(0)}%, ` +
    `PnL $${p.totalPnl.toFixed(0)}, avgRR ${p.avgRR.toFixed(2)}, PF ${fmtPF(p.profitFactor)}, ` +
    `avgWinner $${p.avgWinner.toFixed(0)}, avgLoser $${p.avgLoser.toFixed(0)}, confidence ${p.confidence.level} (n=${p.confidence.sampleSize})`
  );
  if (p.bestPeriod) lines.push(`Best week: ${p.bestPeriod.label} ($${p.bestPeriod.pnl.toFixed(0)})`);
  if (p.worstPeriod) lines.push(`Worst week: ${p.worstPeriod.label} ($${p.worstPeriod.pnl.toFixed(0)})`);

  if (a.instruments.length) lines.push(`\nBY INSTRUMENT:\n${a.instruments.map(fmtGroup).join('\n')}`);
  if (a.sessions.length) lines.push(`\nBY SESSION:\n${a.sessions.map(fmtGroup).join('\n')}`);
  if (a.confirmations.length) lines.push(`\nBY MODEL/SETUP:\n${a.confirmations.map(fmtGroup).join('\n')}`);
  if (a.confirmationTags.length) lines.push(`\nBY CONFIRMATION TAG:\n${a.confirmationTags.map(fmtGroup).join('\n')}`);
  if (a.confirmationCombos.length) lines.push(`\nBY CONFIRMATION COMBO:\n${a.confirmationCombos.map(fmtGroup).join('\n')}`);
  if (a.emotions.length) lines.push(`\nBY EMOTIONAL STATE:\n${a.emotions.map(fmtGroup).join('\n')}`);

  lines.push(`\nBY DIRECTION:\n${fmtGroup(a.direction.long)}\n${fmtGroup(a.direction.short)}`);

  if (a.time.bestHour) lines.push(`\nBest hour: ${fmtGroup(a.time.bestHour)}`);
  if (a.time.worstHour) lines.push(`Worst hour: ${fmtGroup(a.time.worstHour)}`);
  if (a.time.bestWeekday) lines.push(`Best weekday: ${fmtGroup(a.time.bestWeekday)}`);
  if (a.time.worstWeekday) lines.push(`Worst weekday: ${fmtGroup(a.time.worstWeekday)}`);
  if (a.time.bestMonth) lines.push(`Best month: ${fmtGroup(a.time.bestMonth)}`);

  return lines.join('\n');
}

const TREND_LABEL: Record<string, string> = { up: 'improved', down: 'declined', flat: 'flat' };

/** Renders a PeriodComparison (this week vs last week vs trailing 4-week
    baseline, plus the concentration/over-reliance check) into a compact
    numbers-only block — same discipline as summarizeAnalysis: the model may
    only cite what's written here. */
export function summarizeComparison(c: PeriodComparison): string {
  const lines: string[] = [];
  const metric = (label: string, m: PeriodComparison['winRate'], unit = '') =>
    `${label}: ${m.current.toFixed(2)}${unit} (${TREND_LABEL[m.trend]} vs last week${m.prevWeek !== null ? ` ${m.prevWeek.toFixed(2)}${unit}` : ', no prior week data'}${m.baseline4wk !== null ? `; trailing 4-week baseline ${m.baseline4wk.toFixed(2)}${unit}` : ''})`;

  lines.push(metric('Win rate', c.winRate, '%'));
  lines.push(metric('Avg RR', c.avgRR, 'R'));
  lines.push(metric('Profit factor', c.profitFactor, ''));

  if (c.concentration.isOverReliant && c.concentration.overRelianceSubject) {
    const s = c.concentration.overRelianceSubject;
    lines.push(`CONCENTRATION: ${(s.pctOfTrades * 100).toFixed(0)}% of this week's trades were ${s.dimension} "${s.label}" — the week may have been carried by this one condition.`);
  } else {
    lines.push('CONCENTRATION: trades were reasonably spread across instruments/sessions/setups this week.');
  }

  return lines.join('\n');
}

/** Renders the trader's currently-tracked recurring patterns (pattern_memory)
    into a compact block, for citing continuity/change across weeks. */
export function summarizePatternMemory(rows: PatternMemoryRow[]): string {
  if (rows.length === 0) return 'No recurring patterns tracked yet.';
  return rows
    .map(r => `${JSON.stringify(r.subject)}: status ${r.status}, winRate ${r.currentMetric.winRate.toFixed(0)}% (n=${r.currentSampleSize}, confidence ${r.currentConfidenceLevel}), first seen ${r.firstDetectedAt.slice(0, 10)}, last updated ${r.lastUpdatedAt.slice(0, 10)}`)
    .join('\n');
}

/** Renders the durable AI Memory known-facts list — persistent context the
    model should treat as already-established, not rediscover from scratch. */
export function summarizeKnownFacts(facts: KnownFact[]): string {
  if (facts.length === 0) return 'No durable facts established yet — this is early in the trader\'s history with the system.';
  return facts.map(f => `- ${f.fact} (known since ${f.firstStatedAt.slice(0, 10)}, confidence ${f.confidence})`).join('\n');
}

const ROOT_CAUSE_LABEL: Record<string, string> = {
  exit_management: 'the change traces to exit management (cutting winners short relative to plan), not entry quality',
  entry_selectivity: 'the change traces to entry selectivity (win rate moved while reward-to-risk per trade did not), not exits',
  loss_sizing: 'the change traces to loss sizing (losses grew relative to winners despite stable win rate and RR)',
  sample_variance: 'multiple metrics moved together with no single distinguishing mechanism — treat this as possible variance, not a proven cause',
};

/** Renders the root-cause diagnosis (or its absence) for the narrative
    prompt — the model verbalizes this label, it never invents its own cause. */
export function summarizeRootCause(finding: RootCauseFinding | null): string {
  if (!finding) return 'No single clear root cause stands out this week — describe what happened without forcing a cause.';
  const e = finding.evidence;
  return `ROOT CAUSE CANDIDATE (${finding.headlineMetric}): ${ROOT_CAUSE_LABEL[finding.kind]}. ` +
    `Evidence: winRate ${e.winRateNow.toFixed(0)}% (was ${e.winRatePrev.toFixed(0)}%), avgRR ${e.avgRRNow.toFixed(2)}R (was ${e.avgRRPrev.toFixed(2)}R), ` +
    `profitFactor ${fmtPF(e.profitFactorNow)} (was ${fmtPF(e.profitFactorPrev)}), exit ratio ${e.exitRatioNow.toFixed(2)} (was ${e.exitRatioPrev.toFixed(2)}).`;
}
