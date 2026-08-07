// ─────────────────────────────────────────────────────────────────────────────
// Query builder — turns TodaySignals into the text we embed for RAG.
//
// Design principles:
//   - Mixed Hebrew + English on purpose: the notebook itself is mixed
//     (setup names / session codes stay English by convention, prose is
//     Hebrew), so the query matches.
//   - Dense: no filler words. The embedding model reads intent from the
//     nouns and adjectives, not from grammar.
//   - Never blank: even on a no-trade day we produce something meaningful
//     ("יום ללא מסחר") so retrieval can still surface prep/plan notes.
// ─────────────────────────────────────────────────────────────────────────────

import type { TodaySignals } from '../analyzers/todaySignals';

const SIG_LABEL: Record<TodaySignals['significance'], string> = {
  no_trades:  'יום ללא מסחר',
  red_day:    'יום אדום',
  green_day:  'יום ירוק',
  normal:     'יום שקט',
};

/** Format the net R with sign for readability inside the query. */
function fmtNetR(r: number): string {
  if (r === 0) return '0R';
  return (r > 0 ? '+' : '') + r.toFixed(1) + 'R';
}

/** Compose the query text. Ordered by information density — the fields most
 *  likely to differentiate this day from other days come first. */
export function buildRetrievalQuery(signals: TodaySignals): string {
  const parts: string[] = [];

  parts.push('יום מסחר:');

  if (signals.n_trades === 0) {
    parts.push('אין עסקאות');
  } else {
    parts.push(`${signals.n_trades} עסקאות`);
    parts.push(`נטו ${fmtNetR(signals.net_r)}`);
  }

  if (signals.setups.length)   parts.push(signals.setups.join(', '));
  if (signals.sessions.length) parts.push(signals.sessions.join(', '));

  if (signals.emotions.length) parts.push(signals.emotions.join(', '));

  if (signals.rules_violated > 0) {
    parts.push(`${signals.rules_violated} הפרות חוקים`);
  }

  parts.push(SIG_LABEL[signals.significance]);

  return parts.join(' · ');
}
