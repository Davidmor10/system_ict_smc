// ─────────────────────────────────────────────────────────────────────────────
// Guardrail readings — the numbers that decide whether an improvement was real.
//
// Pure. No AI, no network, no async.
//
// experiment.ts defines WHICH guardrails each behaviour needs and which
// direction counts as damage. This file produces the actual numbers, from the
// same trades everything else reads.
//
// The reason they are measured at all: every instruction the system can give
// has a cheap way to satisfy it. "Stop exiting early" is satisfied by not
// trading, by holding every loser to the stop, or by no longer recording where
// you got out. All three drive the target rate to zero. Only the guardrails
// tell those apart from actually changing the habit, and a system that cannot
// tell them apart will eventually congratulate a trader for giving up.
//
// Each reading is computed over whatever slice of trades the caller passes —
// the trailing window when an experiment starts, the since-start window when
// it is measured. Same function both times, so the two numbers are comparable
// by construction rather than by convention.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeRow } from '../types';
import type { GuardrailKind } from './experiment';

const DECIDED = new Set(['WIN', 'LOSS', 'BE']);

function round2(n: number): number { return Math.round(n * 100) / 100; }

export type GuardrailReadings = Record<GuardrailKind, number>;

/** Read every guardrail over one slice of trades.
 *
 *  Missing inputs produce 0, and 0 is safe here in a specific sense: a
 *  guardrail only fires on a DROP from its baseline, so a metric that was
 *  never measurable in the first place cannot manufacture a failure. What it
 *  can do is mask one — which is what `logging_rate` exists to catch. */
export function computeGuardrails(trades: readonly TradeRow[]): GuardrailReadings {
  const decided = trades.filter(t => !t.deleted_at && DECIDED.has(t.result));

  // Trades per active day, not trades outright. The raw count would fall
  // simply because the window is shorter, which would read as "they stopped
  // trading" every time an experiment is measured early.
  const days = new Set(decided.map(t => t.date)).size;
  const tradeFrequency = days ? round2(decided.length / days) : 0;

  // Mean R of the losing trades. Negative by nature; more negative is worse.
  // Only measured R counts — a trade whose R was assumed from the plan would
  // report exactly -1 and flatten the very thing we are watching for.
  const losses = decided
    .filter(t => t.result === 'LOSS' && typeof t.r_multiple === 'number')
    .map(t => t.r_multiple as number);
  const avgLossR = losses.length
    ? round2(losses.reduce((s, r) => s + r, 0) / losses.length)
    : 0;

  // Share of trades whose exit was actually recorded. This is the guardrail
  // against the cheapest win of all: the behaviour becomes undetectable
  // because the field stopped being filled in, and the rate drops to zero
  // while nothing about the trading changed.
  const logged = decided.filter(t => t.exit_price != null).length;
  const loggingRate = decided.length ? round2(logged / decided.length) : 0;

  // Share of GRADED trades that followed the rules — ungraded ones are left
  // out of both sides. Counting them as compliant would let a trader improve
  // this number by no longer answering the question.
  const graded = decided.filter(t => t.followed_rules != null);
  const kept   = graded.filter(t => t.followed_rules === true).length;
  const ruleAdherence = graded.length ? round2(kept / graded.length) : 0;

  return {
    trade_frequency: tradeFrequency,
    avg_loss_r:      avgLossR,
    logging_rate:    loggingRate,
    rule_adherence:  ruleAdherence,
  };
}

/** Pair a stored snapshot with a fresh one, for the guardrails an experiment
 *  actually declared. Kinds not in `kinds` are dropped: measuring a guardrail
 *  the experiment never claimed to protect invites a verdict of "you broke
 *  something" about a number nobody was watching. */
export function pairGuardrails(
  kinds: readonly GuardrailKind[],
  before: GuardrailReadings,
  after: GuardrailReadings,
): Array<{ kind: GuardrailKind; before: number; after: number }> {
  return kinds.map(kind => ({ kind, before: before[kind], after: after[kind] }));
}
