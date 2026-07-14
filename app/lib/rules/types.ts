// ─────────────────────────────────────────────────────────────────────────────
// Trading-rule data model. Stored as a jsonb blob in user_collections (kind
// 'rules') — no dedicated table, so every new field is OPTIONAL with a safe
// default and old rules (which only have {id, text, category, isActive}) keep
// working untouched. `text` is the legacy title field; `title` supersedes it.
// ─────────────────────────────────────────────────────────────────────────────

export type RuleCategory = 'discipline' | 'entry' | 'trade_mgmt' | 'risk' | 'time' | 'news';
export type VerificationMode = 'automatic' | 'user_report';
export type RuleSeverity = 'recommendation' | 'important' | 'critical';
export type RuleScope = 'always' | 'per_symbol' | 'per_session' | 'per_day' | 'per_hour' | 'around_news';

export type ConditionType =
  | 'max_trades_per_day'
  | 'max_risk_per_trade'
  | 'max_daily_loss'
  | 'stop_after_losses'
  | 'allowed_hours'
  | 'allowed_sessions'
  | 'allowed_symbols'
  | 'no_trade_around_news'
  | 'required_confirmations';

/** The tunable numbers/lists behind a condition. Only the fields relevant to the
    rule's `conditionType` are set; the rest stay undefined. */
export interface ConditionValue {
  max?: number;          // max_trades_per_day
  maxUsd?: number;       // max_risk_per_trade / max_daily_loss
  losses?: number;       // stop_after_losses
  startMin?: number;     // allowed_hours — minutes of day
  endMin?: number;       // allowed_hours — minutes of day
  sessions?: string[];   // allowed_sessions — session keys
  symbols?: string[];    // allowed_symbols — instrument keys
  beforeMin?: number;    // no_trade_around_news — minutes before the event
  afterMin?: number;     // no_trade_around_news — minutes after the event
  tags?: string[];       // required_confirmations — confirmation tags
}

export interface Rule {
  id: string;
  /** New primary title. Old rules have only `text`; use ruleTitle() to read. */
  title?: string;
  /** Legacy title field — still present on rules created before this feature. */
  text?: string;
  /** RuleCategory, or a legacy value ('exit') on old rules. Kept as string so
      an unknown category never crashes rendering. */
  category: string;
  verificationMode?: VerificationMode;
  conditionType?: ConditionType;
  conditionValue?: ConditionValue;
  severity?: RuleSeverity;
  scope?: RuleScope;
  reason?: string;
  isActive: boolean;
  createdAt?: number;
  updatedAt?: number;
  deleted?: boolean;
}

export type RuleCheckStatus = 'followed' | 'violated' | 'unknown';

/** A persisted check — ONLY ever a manual user report (automatic checks are
    computed on the fly and never stored). Deduped by (ruleId, tradeId ?? date). */
export interface RuleCheck {
  id: string;
  ruleId: string;
  tradeId?: number;
  date?: string;
  status: RuleCheckStatus;
  detectedAt: number;
  source: 'automatic' | 'user';
  evidence: string;
  updatedAt?: number;
  deleted?: boolean;
}

/** The rule's display title, tolerant of legacy rows (title ← text). */
export function ruleTitle(r: Rule): string {
  return (r.title ?? r.text ?? '').trim();
}

/** Safe defaults for reading a possibly-legacy rule. */
export function ruleVerification(r: Rule): VerificationMode {
  return r.verificationMode ?? 'user_report';
}
export function ruleSeverity(r: Rule): RuleSeverity {
  return r.severity ?? 'important';
}
export function ruleScope(r: Rule): RuleScope {
  return r.scope ?? 'always';
}

/** Dedup key for a manual check — one record per rule per event (trade or day). */
export function checkKey(c: Pick<RuleCheck, 'ruleId' | 'tradeId' | 'date'>): string {
  return `${c.ruleId}:${c.tradeId ?? c.date ?? ''}`;
}

/** Upsert a manual check, replacing any existing check for the same
    (ruleId, tradeId ?? date) so the same event is never recorded twice. */
export function upsertCheck(checks: RuleCheck[], next: RuleCheck): RuleCheck[] {
  const k = checkKey(next);
  return [...checks.filter(c => checkKey(c) !== k), next];
}
