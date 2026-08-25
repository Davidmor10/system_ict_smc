import type { FullAnalysis, GroupPerformance, PatternCandidate } from '../analytics';
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

  const ex = a.exits;
  if (ex.sampleSize > 0) {
    lines.push(
      `\nEXIT MANAGEMENT (${ex.sampleSize} trades with recorded exit legs): ` +
      `avgWinnerR ${ex.avgWinnerR.toFixed(2)}, avgLoserR ${ex.avgLoserR.toFixed(2)}, ` +
      `capture ratio ${ex.captureRatio === null ? 'n/a' : ex.captureRatio.toFixed(2)} (realized÷planned R on winners; <1 = cutting winners short), ` +
      `${ex.winnersCutShort}/${ex.winnerCount} winners closed below 60% of planned target, ` +
      `partial-exit rate ${(ex.partialExitRate * 100).toFixed(0)}%`
    );
  }

  if (a.time.bestHour) lines.push(`\nBest hour: ${fmtGroup(a.time.bestHour)}`);
  if (a.time.worstHour) lines.push(`Worst hour: ${fmtGroup(a.time.worstHour)}`);
  if (a.time.bestWeekday) lines.push(`Best weekday: ${fmtGroup(a.time.bestWeekday)}`);
  if (a.time.worstWeekday) lines.push(`Worst weekday: ${fmtGroup(a.time.worstWeekday)}`);
  if (a.time.bestMonth) lines.push(`Best month: ${fmtGroup(a.time.bestMonth)}`);

  return lines.join('\n');
}

/** How many candidates to render. The prompt already fights
 *  Lost-in-the-Middle by injecting only the blocks a question needs, and a
 *  hundred slices would undo that on its own. Significant ones are never
 *  dropped by this cap — it only limits the tail. */
export const MAX_PATTERNS_IN_FACTS = 12;

/** The discovered slices, with the one distinction that matters attached to
 *  every line.
 *
 *  Discovery deliberately cuts the history about a hundred ways, and at that
 *  count several slices clear any win-rate gap by chance — for every trader,
 *  including one entering at random. `significant` means the slice survived
 *  its p-value being corrected for how many slices were tried; everything else
 *  is an observation about a subset and nothing more.
 *
 *  Both are shown, because "your Tuesdays look bad but it does not survive the
 *  correction yet" is a genuinely useful answer and hiding the candidate makes
 *  it unavailable. The label carries the whole weight, so it is stated per
 *  line rather than once in a heading the model may skim past. */
export function summarizePatterns(patterns: PatternCandidate[]): string {
  if (!patterns.length) return '';

  const significant = patterns.filter(p => p.significant);
  const rest = patterns
    .filter(p => !p.significant)
    .sort((a, b) => a.pAdjusted - b.pAdjusted)
    .slice(0, Math.max(0, MAX_PATTERNS_IN_FACTS - significant.length));

  const line = (p: PatternCandidate) => {
    const subject = Object.entries(p.subject).map(([k, v]) => `${k}=${v}`).join(', ');
    const verdict = p.significant
      ? 'SURVIVED multiple-comparison correction — may be described as a real pattern'
      : 'did NOT survive correction — an observation about a subset, never to be called an edge or a pattern';
    return `- [${p.kind}] ${subject}: winRate ${p.metric.winRate.toFixed(0)}% vs ${p.baseline.toFixed(0)}% overall, ` +
      `n=${p.metric.trades} (${p.metric.wins}W/${p.metric.losses}L), PnL $${p.metric.totalPnl.toFixed(0)}, ` +
      `adjusted p=${p.pAdjusted < 0.001 ? '<0.001' : p.pAdjusted.toFixed(3)} — ${verdict}`;
  };

  const parts: string[] = [];
  parts.push(significant.length
    ? `CONFIRMED PATTERNS (${significant.length}) — these survived correction for the ~${patterns.length} slices tested:\n${significant.map(line).join('\n')}`
    : `CONFIRMED PATTERNS: none. ${patterns.length} slices were tested and none survived correction. Say so plainly if asked whether they have an edge in some condition — "not yet distinguishable from chance" is the honest answer, not a hedge.`);

  if (rest.length) {
    parts.push(`UNCONFIRMED SLICES (${rest.length} of ${patterns.length - significant.length}, closest to significance first) — cite the numbers if asked, but never present these as findings:\n${rest.map(line).join('\n')}`);
  }

  return parts.join('\n\n');
}

/** Expectancy, streaks, plan-vs-execution and record completeness.
 *
 *  Completeness is last and is the most important line in the block: it is the
 *  only place the model is told what the record CANNOT answer. A trader who
 *  logs exits on a fifth of their trades does not have a journal with a gap,
 *  they have a journal that cannot speak to exits — and without this the model
 *  sees only a small sample and reads it as a weak signal rather than as an
 *  absent one.
 *
 *  `scope` is not decoration. The same function renders a whole history and a
 *  single week, and "longest losing streak: 3" means very different things in
 *  the two. Unlabelled, a weekly block would quietly hand the model a
 *  within-the-week figure to state as a career high. Every heading carries the
 *  scope so the sentence built from it cannot outrun the window it came
 *  from. */
export function summarizeDepth(a: FullAnalysis, scope = 'OVER THE WHOLE RECORDED HISTORY'): string {
  const lines: string[] = [];
  const e = a.expectancy;
  if (e.trades > 0) {
    lines.push(
      `EXPECTANCY ${scope} (${e.trades} decided trades): $${e.expectancyUsd.toFixed(0)} and ${e.expectancyR.toFixed(2)}R per trade. ` +
      // expectancy().winRate is a 0-1 FRACTION, unlike GroupPerformance.winRate
      // which is already 0-100. Rendering it with the same formatter turned a
      // 50% win rate into "1%" in the prompt — a wrong number stated to the
      // model with total confidence, which is the one thing this whole file
      // exists to prevent.
      `Built from winRate ${(e.winRate * 100).toFixed(0)}%, avg winner ${e.avgWinR.toFixed(2)}R, avg loser ${e.avgLossR.toFixed(2)}R. ` +
      `The decomposition is the point: the same expectancy from a high win rate with small winners is an EXIT problem, and from a low win rate with large winners is an ENTRY problem.`
    );
  }

  const st = a.streaks;
  lines.push(
    `STREAKS ${scope}: currently ${st.current === 0 ? 'no active streak (last decided trade was a breakeven, or there are none)' : st.current > 0 ? `${st.current} wins in a row` : `${Math.abs(st.current)} losses in a row`}. ` +
    `Longest win streak ${st.maxWin}, longest losing streak ${st.maxLoss}. Breakevens break a streak rather than extending it.`
  );

  const pv = a.planVsExecution;
  if (pv.measured > 0) {
    lines.push(
      `PLAN VS EXECUTION ${scope}: ${pv.measured} trades have both a plan and a logged exit; ${pv.assumed} more have an R assumed from the result alone and cannot answer this. ` +
      `Avg planned ${pv.avgPlannedRR.toFixed(2)}R, avg realized ${pv.avgRealizedR.toFixed(2)}R, capture rate on winners ${pv.captureRate === null ? 'n/a' : pv.captureRate.toFixed(2)} (realized÷planned; below 1 = winners closed short of their own target).`
    );
  }

  const c = a.completeness;
  if (c.trades > 0) {
    const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
    lines.push(
      `RECORD COMPLETENESS ${scope}, over ${c.trades} closed trades — exit price ${pct(c.exitPrice)}, rules answered ${pct(c.rulesAnswer)}, confirmations tagged ${pct(c.confirmations)}, stop handling answered ${pct(c.stopAnswer)}, notes written ${pct(c.notes)}; overall ${pct(c.overall)}. ` +
      `THIS BOUNDS WHAT YOU MAY CONCLUDE. Where a field is logged on a small share of trades, the honest answer to a question about it is that the record cannot answer it yet — not a cautious claim built on the few trades that happen to carry it.`
    );
  }

  return lines.join('\n\n');
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
