import type { TradeEntry } from '../journal';
import { computeGroupPerformance } from './metrics';
import type { GroupPerformance, TimeSummary } from './types';

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** dateISO ("YYYY-MM-DD") is a local calendar day, not a UTC instant — parse
    it as local components so weekday/week bucketing matches the trader's
    own wall clock instead of drifting a day near UTC midnight. */
function parseLocalDate(dateISO: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function hourOf(t: TradeEntry): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.time || '');
  return m ? parseInt(m[1], 10) : null;
}

function weekdayOf(t: TradeEntry): number {
  return parseLocalDate(t.dateISO).getDay();
}

function monthKeyOf(t: TradeEntry): string {
  return t.dateISO.slice(0, 7); // YYYY-MM
}

/** ISO-8601 week key ("2026-W14"), Monday-start, week 1 = week containing
    the year's first Thursday. */
export function isoWeekKey(dateISO: string): string {
  const d = parseLocalDate(dateISO);
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target.valueOf() - firstThursday.valueOf();
  const week = 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
  return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function pickExtreme(groups: GroupPerformance[], by: (g: GroupPerformance) => number, mode: 'max' | 'min'): GroupPerformance | null {
  const eligible = groups.filter(g => g.trades > 0);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, g) => {
    const cmp = by(g);
    const bestCmp = by(best);
    return mode === 'max' ? (cmp > bestCmp ? g : best) : (cmp < bestCmp ? g : best);
  });
}

function bucketBy<K extends string | number>(trades: TradeEntry[], keyOf: (t: TradeEntry) => K | null): Map<K, TradeEntry[]> {
  const buckets = new Map<K, TradeEntry[]>();
  for (const t of trades) {
    const k = keyOf(t);
    if (k === null) continue;
    const arr = buckets.get(k);
    if (arr) arr.push(t); else buckets.set(k, [t]);
  }
  return buckets;
}

export function analyzeTime(trades: TradeEntry[]): TimeSummary {
  const hourBuckets = bucketBy(trades, hourOf);
  const byHour = [...hourBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([h, ts]) => computeGroupPerformance(ts, String(h), `${String(h).padStart(2, '0')}:00`));

  const weekdayBuckets = bucketBy(trades, weekdayOf);
  const byWeekday = [...weekdayBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([w, ts]) => computeGroupPerformance(ts, String(w), WEEKDAY_LABELS[w]));

  const weekBuckets = bucketBy(trades, t => isoWeekKey(t.dateISO));
  const byWeek = [...weekBuckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([wk, ts]) => computeGroupPerformance(ts, wk, wk));

  const monthBuckets = bucketBy(trades, monthKeyOf);
  const byMonth = [...monthBuckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mk, ts]) => computeGroupPerformance(ts, mk, mk));

  return {
    byHour,
    byWeekday,
    byWeek,
    byMonth,
    bestHour: pickExtreme(byHour, g => g.winRate, 'max'),
    worstHour: pickExtreme(byHour, g => g.winRate, 'min'),
    bestWeekday: pickExtreme(byWeekday, g => g.winRate, 'max'),
    worstWeekday: pickExtreme(byWeekday, g => g.winRate, 'min'),
    strongestWeek: pickExtreme(byWeek, g => g.totalPnl, 'max'),
    weakestWeek: pickExtreme(byWeek, g => g.totalPnl, 'min'),
  };
}
