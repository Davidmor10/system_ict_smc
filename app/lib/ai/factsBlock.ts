import type { FullAnalysis, GroupPerformance } from '../analytics';

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

  lines.push(`\nBY DIRECTION:\n${fmtGroup(a.direction.long)}\n${fmtGroup(a.direction.short)}`);

  if (a.time.bestHour) lines.push(`\nBest hour: ${fmtGroup(a.time.bestHour)}`);
  if (a.time.worstHour) lines.push(`Worst hour: ${fmtGroup(a.time.worstHour)}`);
  if (a.time.bestWeekday) lines.push(`Best weekday: ${fmtGroup(a.time.bestWeekday)}`);
  if (a.time.worstWeekday) lines.push(`Worst weekday: ${fmtGroup(a.time.worstWeekday)}`);

  return lines.join('\n');
}
