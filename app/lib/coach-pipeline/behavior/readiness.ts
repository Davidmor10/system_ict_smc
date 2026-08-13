// ─────────────────────────────────────────────────────────────────────────────
// What the coach can see, and what it is waiting for. Pure.
//
// WHY THIS IS A FEATURE AND NOT A DEBUG SCREEN
//
// The behaviour layer is deliberately silent until the evidence supports
// speaking. That is the right behaviour and it has one bad side effect: to the
// trader, a system that is correctly saying nothing is indistinguishable from
// one that is broken, or from one that has looked at their trading and found
// nothing worth mentioning. All three look like an empty card.
//
// The card said "your first insight is on the way" — a promise with no path.
// Meanwhile the analysis knew precisely what was missing: this detector needs
// an exit price and has one trade out of eight; that one needs the rules
// answer and has three. That is the single most useful thing the system can
// say to a trader who hasn't yet given it enough to work with, and it was
// sitting in an owner-only debug route.
//
// Every line here is a fact about the trader's own journal, in their language,
// with a number they can move. Nothing is a nag: a detector that is ready says
// so and gets out of the way.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeRow } from '../types';
import { MIN_DECIDED_FOR_CLAIM } from '../../stats/evidence';
import { SIZE_BASELINE_MIN } from './behaviors';

const DECIDED = new Set(['WIN', 'LOSS', 'BE']);

export type ReadinessState =
  /** Enough trades carry the field; this detector is working. */
  | 'ready'
  /** Some trades carry it, not yet enough. */
  | 'partial'
  /** No trade carries it — the detector is blind, not clean. */
  | 'blocked';

export interface DetectorReadiness {
  kind:   string;
  /** What it looks for, phrased as the trader would describe it. */
  label:  string;
  state:  ReadinessState;
  /** Trades that carry what this detector needs. */
  have:   number;
  /** Trades it needs before it can say anything. */
  need:   number;
  /** The action that moves `have` — one sentence, imperative, specific. */
  action: string;
}

export interface Readiness {
  tradesTotal:   number;
  tradesDecided: number;
  detectors:     DetectorReadiness[];
  /** How many detectors can currently see anything. The headline number. */
  readyCount:    number;
}

function stateFor(have: number, need: number): ReadinessState {
  if (have >= need) return 'ready';
  return have === 0 ? 'blocked' : 'partial';
}

/** Read the journal and say what the coach can and cannot see.
 *
 *  Free — no model, no writes. Safe to call on every page load. */
export function computeReadiness(trades: readonly TradeRow[]): Readiness {
  const decided = trades.filter(t => !t.deleted_at && DECIDED.has(t.result));
  const count = (p: (t: TradeRow) => boolean) => decided.filter(p).length;

  // The confirmations field only becomes evidence from the first trade that
  // carried one — before that, an empty box says nothing about the trade.
  const chronological = [...decided].sort((a, b) =>
    (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
  const adoptedAt = chronological.findIndex(t => (t.confirmations?.length ?? 0) > 0);
  const confirmationsHave = adoptedAt >= 0 ? chronological.length - adoptedAt : 0;

  const detectors: DetectorReadiness[] = [
    {
      kind:  'discretionary_exit',
      label: 'יציאה לפני היעד או אחרי הסטופ',
      have:  count(t => t.exit_price != null && t.take_profit != null),
      need:  MIN_DECIDED_FOR_CLAIM,
      action: 'מלא את "איפה יצאת בפועל" בטופס. בלי המחיר הזה, ה-R מחושב לפי התוכנית ולא לפי מה שקרה.',
      state: 'blocked',
    },
    {
      kind:  'rule_violation',
      label: 'סטייה מהחוקים שלך',
      have:  count(t => t.followed_rules != null),
      need:  MIN_DECIDED_FOR_CLAIM,
      action: 'סמן "עמדתי" או "סטיתי" בטופס. זו התשובה היחידה שרק אתה יכול לתת.',
      state: 'blocked',
    },
    {
      kind:  'no_confirmation',
      label: 'כניסה בלי אישור מתועד',
      have:  confirmationsHave,
      need:  MIN_DECIDED_FOR_CLAIM,
      action: 'בחר את האישורים שראית לפני הכניסה. נספר רק מהעסקה הראשונה שמילאת בה.',
      state: 'blocked',
    },
    {
      kind:  'stop_widened',
      label: 'הרחקת הסטופ אחרי הכניסה',
      have:  count(t => t.stop_moved != null),
      need:  MIN_DECIDED_FOR_CLAIM,
      action: 'ענה "מה קרה לסטופ" בסגירת העסקה. קידום והרחקה הם שני דברים הפוכים — לכן יש שלוש תשובות ולא שתיים.',
      state: 'blocked',
    },
    {
      kind:  'size_spike',
      label: 'הגדלת גודל פוזיציה מעל הרגיל',
      have:  Math.max(0, decided.length - SIZE_BASELINE_MIN),
      need:  MIN_DECIDED_FOR_CLAIM,
      action: 'זה עובד לבד — צריך רק עוד עסקאות כדי שיהיה "גודל רגיל" להשוות אליו.',
      state: 'blocked',
    },
  ].map(d => ({ ...d, state: stateFor(d.have, d.need) }));

  return {
    tradesTotal:   trades.length,
    tradesDecided: decided.length,
    detectors,
    readyCount:    detectors.filter(d => d.state === 'ready').length,
  };
}
