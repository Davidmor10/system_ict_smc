'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { TradeEntry } from '../lib/journal';
import { tradePnL, rMultiple } from '../lib/journal';
import {
  splitHalves, summarizeTrader, winRateShift,
  type BehaviourFacts, type TradingFacts,
} from '../lib/progress/traderSummary';

// ─────────────────────────────────────────────────────────────────────────────
// The dashboard's opening paragraph.
//
// The dashboard is supposed to BE the summary and was a grid of nine tiles.
// Behaviour got prose on the journey page; the trading half never did, so the
// only account a trader had of their own performance was numbers in boxes.
// This is both halves, in the same voice, in the place a person already lands.
//
// It replaced the state panel rather than sitting beside it. Two adjacent
// blocks both summarising is the scatter this was meant to fix.
//
// THREE THINGS IT WILL NOT DO, AND THE FENCES ARE IN THE LIB
//
//   • Claim a trend it has not tested. The win-rate sentence runs a two-sided
//     exact test, corrected for the one comparison made, against the sample
//     floor the rest of the codebase shares. Below that floor it says it
//     cannot compare — it never picks a direction.
//   • Name an edge. The performance half says what happened, never what
//     works; that is the analytics stack's claim to make, and a dashboard
//     announcing an edge next to a screen that says there is not enough data
//     is the failure docs/ai-architecture.md exists to prevent.
//   • Say why, or say what to do. Both are asserted by tests.
// ─────────────────────────────────────────────────────────────────────────────

interface Journey {
  counts: { working: number; changed: number; watching: number; relapsed: number };
  rows: Array<{ source: string; status: string | null; label: string; window: { done: number; of: number } | null }>;
  insufficientEvidence: boolean;
}

export default function TraderSummary({
  trades, accountStart,
}: { trades: TradeEntry[]; accountStart: number }) {
  const [journey, setJourney] = useState<Journey | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/coach/journey', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d?.counts) setJourney(d as Journey); })
      .catch(() => { /* the trading half stands on its own */ });
    return () => { alive = false; };
  }, []);

  const lines = useMemo(() => {
    const closed = trades.filter(t => t.result !== 'OPEN');
    const wins = closed.filter(t => t.result === 'WIN');
    const losses = closed.filter(t => t.result === 'LOSS');
    const bes = closed.filter(t => t.result === 'BE');
    const decided = wins.length + losses.length;

    const pnlOf = (t: TradeEntry) => t.pnlUsd ?? tradePnL(t) ?? 0;
    const rOf = (t: TradeEntry) => t.tradeR ?? rMultiple(t) ?? 0;
    const winsPnl = wins.reduce((s, t) => s + Math.abs(pnlOf(t)), 0);
    const lossesPnl = losses.reduce((s, t) => s + Math.abs(pnlOf(t)), 0);

    const facts: TradingFacts = {
      closed: closed.length,
      wins: wins.length, losses: losses.length, bes: bes.length, decided,
      winRate: decided ? wins.length / decided : null,
      // Infinity is not a profit factor a sentence can carry, so an account
      // with no losing trade yet simply does not get the clause.
      profitFactor: lossesPnl > 0 ? winsPnl / lossesPnl : null,
      avgR: closed.length ? closed.reduce((s, t) => s + rOf(t), 0) / closed.length : null,
      netPnl: closed.reduce((s, t) => s + pnlOf(t), 0),
      startingBalance: accountStart || null,
      tradingDays: new Set(closed.map(t => t.dateISO)).size,
      missingExit: closed.filter(t => (t.exits?.length ?? 0) === 0).length,
      missingRules: closed.filter(t => typeof t.followedRules !== 'boolean').length,
    };

    // Chronological, because the two halves are earlier and later — sorting by
    // anything else would compare two arbitrary groups and call it a trend.
    const ordered = [...closed]
      .sort((a, b) => (a.dateISO + (a.time ?? '')).localeCompare(b.dateISO + (b.time ?? '')))
      .filter(t => t.result === 'WIN' || t.result === 'LOSS')
      .map(t => t.result as 'WIN' | 'LOSS');

    const behaviour: BehaviourFacts | null = journey
      ? {
          watched: journey.rows.filter(r => r.source === 'builtin').length,
          detected: journey.rows.filter(r => r.source === 'builtin' && r.status !== null).length,
          open: (() => {
            const w = journey.rows.find(r => r.window !== null);
            return w?.window ? { label: w.label, done: w.window.done, of: w.window.of } : null;
          })(),
          changed: journey.counts.changed,
          relapsed: journey.counts.relapsed,
          insufficientEvidence: journey.insufficientEvidence,
        }
      : null;

    return summarizeTrader(facts, winRateShift(splitHalves(ordered)), behaviour);
  }, [trades, accountStart, journey]);

  if (lines.length === 0) return null;

  return (
    <section className="dsh-panel" data-reveal="1" aria-label="סיכום">
      <div className="dsh-panel-head">
        <span className="dsh-h"><span className="dsh-h-mark">◈</span>הסיכום שלך</span>
        <Link href="/dashboard/progress" className="dsh-more">למסלול המלא ←</Link>
      </div>
      {/* The first line is the lead and the second the figures; the stylesheet
          reads the index rather than a flag, so the ladder cannot drift out of
          step with the sentences lib/progress/traderSummary produces. */}
      <div className="dsh-lines">
        {lines.map((l, i) => (
          <p key={i} className="dsh-line" data-i={i}>{l}</p>
        ))}
      </div>
    </section>
  );
}
