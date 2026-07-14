// ─────────────────────────────────────────────────────────────────────────────
// Rule Engine — pure, no I/O, no LLM. Evaluates ONE structured rule against a
// trade and its same-day context and returns followed / violated / unknown.
// Cardinal rule: when the data needed to judge a condition is missing, return
// `unknown` with a short reason — never guess `violated`.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeEntry } from '../journal';
import { tradePnL } from '../journal';
import { pointValue } from '../instruments';
import { normSession } from '../analytics';
import type { Rule, ConditionType, RuleCheckStatus } from './types';

export interface RuleCheckContext {
  /** Available macro events (each with an Israel-time HH:mm + date + impact).
      Absent/empty → news rules return `unknown` (never guessed). */
  macroEvents?: { date?: string; time?: string; impact?: string }[];
}

export interface RuleCheckResult {
  status: RuleCheckStatus;
  /** Short Hebrew evidence line — always carries the number it's based on. */
  evidence: string;
}

const unknown = (evidence: string): RuleCheckResult => ({ status: 'unknown', evidence });
const followed = (evidence: string): RuleCheckResult => ({ status: 'followed', evidence });
const violated = (evidence: string): RuleCheckResult => ({ status: 'violated', evidence });

/** Condition types the engine can actually evaluate in this version. Anything
    outside this list (and any user_report rule) resolves to `unknown`. */
export const AUTO_SUPPORTED: ConditionType[] = [
  'max_trades_per_day', 'max_risk_per_trade', 'max_daily_loss', 'stop_after_losses',
  'allowed_hours', 'allowed_sessions', 'allowed_symbols', 'required_confirmations',
];

function minutesOfTime(time: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time || '');
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? h * 60 + mi : null;
}
function inWindow(m: number, start: number, end: number): boolean {
  return end > start ? m >= start && m < end : m >= start || m < end;
}
/** Planned $ risk of a trade — |entry − stop| × point value × contracts. */
function riskUsd(t: TradeEntry): number | null {
  if (!t.entry || !t.stop) return null;
  const dist = Math.abs(t.entry - t.stop);
  if (!Number.isFinite(dist) || dist <= 0) return null;
  return dist * pointValue(t.symbol) * (t.contracts || 1);
}
/** Same-day trades ordered by entry time then id — for "Nth trade" / "after N losses". */
function tradesBefore(trade: TradeEntry, todaysTrades: TradeEntry[]): TradeEntry[] {
  const ordered = [...todaysTrades].sort(
    (a, b) => (minutesOfTime(a.time) ?? 0) - (minutesOfTime(b.time) ?? 0) || a.id - b.id,
  );
  const idx = ordered.findIndex(t => t.id === trade.id);
  return idx <= 0 ? ordered.slice(0, Math.max(idx, 0)) : ordered.slice(0, idx);
}

/** Evaluate `rule` for `trade`. `todaysTrades` are all the trades on the same
    calendar day (including this one), used by the day-scoped conditions. */
export function checkRule(
  rule: Rule,
  trade: TradeEntry,
  todaysTrades: TradeEntry[],
  ctx: RuleCheckContext = {},
): RuleCheckResult {
  if (rule.verificationMode !== 'automatic' || !rule.conditionType) {
    return unknown('חוק לבדיקה ידנית');
  }
  const cv = rule.conditionValue ?? {};

  switch (rule.conditionType) {
    case 'max_trades_per_day': {
      if (cv.max == null) return unknown('לא הוגדר מקסימום עסקאות');
      const rank = tradesBefore(trade, todaysTrades).length + 1;
      return rank > cv.max
        ? violated(`עסקה ${rank} ביום — המקסימום שהגדרת ${cv.max}`)
        : followed(`עסקה ${rank} מתוך ${cv.max} מותרות`);
    }
    case 'max_risk_per_trade': {
      if (cv.maxUsd == null) return unknown('לא הוגדרה תקרת סיכון');
      const r = riskUsd(trade);
      if (r == null) return unknown('אין סטופ — אי אפשר לחשב סיכון');
      return r > cv.maxUsd + 0.005
        ? violated(`סיכון $${r.toFixed(0)} מול תקרה $${cv.maxUsd}`)
        : followed(`סיכון $${r.toFixed(0)} ≤ $${cv.maxUsd}`);
    }
    case 'max_daily_loss': {
      if (cv.maxUsd == null) return unknown('לא הוגדרה תקרת הפסד יומי');
      const prior = tradesBefore(trade, todaysTrades);
      const cum = prior.map(tradePnL).filter((n): n is number => n !== null).reduce((a, b) => a + b, 0);
      return cum <= -cv.maxUsd
        ? violated(`נכנסת אחרי הפסד יומי מצטבר של $${Math.abs(cum).toFixed(0)} (תקרה $${cv.maxUsd})`)
        : followed(`הפסד מצטבר לפני העסקה $${Math.abs(Math.min(cum, 0)).toFixed(0)} ≤ $${cv.maxUsd}`);
    }
    case 'stop_after_losses': {
      if (cv.losses == null) return unknown('לא הוגדר מספר הפסדים לעצירה');
      const priorLosses = tradesBefore(trade, todaysTrades).filter(t => t.result === 'LOSS').length;
      return priorLosses >= cv.losses
        ? violated(`נכנסת אחרי ${priorLosses} הפסדים היום (הכלל: לעצור אחרי ${cv.losses})`)
        : followed(`${priorLosses} הפסדים לפני העסקה`);
    }
    case 'allowed_hours': {
      if (cv.startMin == null || cv.endMin == null) return unknown('לא הוגדרו שעות מותרות');
      const m = minutesOfTime(trade.time);
      if (m == null) return unknown('אין שעת כניסה לעסקה');
      return inWindow(m, cv.startMin, cv.endMin)
        ? followed(`נכנסת ב-${trade.time}, בתוך השעות המותרות`)
        : violated(`נכנסת ב-${trade.time}, מחוץ לשעות המותרות`);
    }
    case 'allowed_sessions': {
      if (!cv.sessions?.length) return unknown('לא הוגדרו סשנים מותרים');
      const s = normSession(trade.session);
      if (!s || s === 'none') return unknown('אין סשן מתועד לעסקה');
      return cv.sessions.map(x => x.toLowerCase()).includes(s)
        ? followed(`סשן ${s} מותר`)
        : violated(`סשן ${s} לא ברשימת הסשנים המותרים`);
    }
    case 'allowed_symbols': {
      if (!cv.symbols?.length) return unknown('לא הוגדרו נכסים מותרים');
      return cv.symbols.includes(trade.symbol)
        ? followed(`${trade.symbol} מותר`)
        : violated(`${trade.symbol} לא ברשימת הנכסים המותרים`);
    }
    case 'required_confirmations': {
      if (!cv.tags?.length) return unknown('לא הוגדרו אישורים נדרשים');
      if (trade.confirmations == null) return unknown('לא תועדו אישורים לעסקה');
      const missing = cv.tags.filter(t => !(trade.confirmations ?? []).includes(t));
      return missing.length === 0
        ? followed('כל האישורים הנדרשים קיימים')
        : violated(`חסרים אישורים: ${missing.join(', ')}`);
    }
    case 'no_trade_around_news': {
      const events = ctx.macroEvents ?? [];
      if (events.length === 0) return unknown('אין נתוני מאקרו זמינים לבדיקה');
      const m = minutesOfTime(trade.time);
      if (m == null) return unknown('אין שעת כניסה לעסקה');
      const before = cv.beforeMin ?? 0, after = cv.afterMin ?? 0;
      const near = events.some(e => {
        if (e.date && e.date !== trade.dateISO) return false;
        const em = minutesOfTime(e.time);
        return em != null && m >= em - before && m <= em + after;
      });
      return near ? violated('נכנסת בסמוך לאירוע מאקרו אסור') : followed('אין אירוע מאקרו סמוך');
    }
    default:
      return unknown('סוג תנאי לא נתמך לבדיקה אוטומטית');
  }
}
