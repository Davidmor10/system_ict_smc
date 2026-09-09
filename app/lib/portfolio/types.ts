// ─────────────────────────────────────────────────────────────────────────────
// A portfolio — the account a trade belongs to.
//
// WHY IT HAS TO BE A REAL ENTITY
//
// `TradeEntry.accountId` has existed since launch as an optional string, and
// "Prop Firm Mode" is named in the comments around it. Neither was ever built:
// no list, no name, no balance, nothing that could be selected. The field was
// a string hanging in the air, written by nobody and read by nobody.
//
// It becomes load-bearing now. A trader with a $50,000 account and a $25,000
// account does not have one journal with two labels in it — they have two
// records that must never be averaged together. Every statistic, every
// pattern, every insight belongs to exactly one of them.
//
// This module is the entity and the rules around it. Pure: no storage, no
// network, no React — see ./store for the client side.
// ─────────────────────────────────────────────────────────────────────────────

import type { Role } from '../getUserRole';
import type { Syncable } from '../sync/merge';

export const PORTFOLIOS_KIND = 'portfolios_v1';
export const PORTFOLIOS_KEY  = 'onyx_portfolios_v1';
/** Which portfolio the trader is currently looking at. Per device on purpose:
 *  a phone and a desktop can sit on different accounts without fighting. */
export const SELECTED_PORTFOLIO_KEY = 'onyx_selected_portfolio';

/** Where a portfolio's trades come from. One value today, and that is the
 *  point of the field being here at all: the day a second broker is supported,
 *  the import path is chosen by data rather than by assumption. */
export type PortfolioSource = 'tradingview';

export interface Portfolio extends Syncable {
  id: string;
  /** The trader's own name for it. Never generated — an account called
   *  "תיק 1" tells them nothing at the moment they need to pick one. */
  name: string;
  source: PortfolioSource;
  /** IANA zone the imported timestamps are read in. Stored per portfolio and
   *  not globally: it belongs to the export, not to the person. */
  timezone: string;
  /** Opening balance in USD. Anchors this portfolio's equity curve and its
   *  drawdown — the number that is wrong for everyone when it is a default. */
  startingBalanceUsd: number;
  createdAt: number;
  /** Epoch ms of the last successful import. Drives "last updated 8 days ago". */
  lastImportAt?: number;
  /** Epoch ms of the last time this portfolio was selected.
   *
   *  The SELECTION itself is per device and never leaves the browser — a phone
   *  and a desktop may sit on different accounts. This is a different fact:
   *  when the account was last looked at, by anyone, on anything. It is here
   *  because the nightly pipeline runs on the ACTIVE portfolio and runs on a
   *  server, which cannot see a localStorage key. Two devices on two accounts
   *  make the newer stamp win, which is the right reading of "active". */
  lastActiveAt?: number;
  updatedAt?: number;
  /** Soft delete, like every other synced list — a hard delete lets another
   *  device's copy resurrect the row on the next merge. Emptying a portfolio's
   *  data for real is a separate, deliberate operation. */
  deleted?: boolean;
}

// ── Plan limits ──────────────────────────────────────────────────────────────

/** How many portfolios each plan may hold.
 *
 *  Free is zero because there is no free tier — an account with no
 *  subscription never reaches a screen that could create one. */
export const PORTFOLIO_LIMIT: Record<Role, number> = {
  free:    0,
  starter: 1,
  pro:     3,
  deluxe:  Number.POSITIVE_INFINITY,
};

/** A ceiling on top of the plan limit, held at one while the analysis layer
 *  still read "all trades" rather than "this portfolio's trades".
 *
 *  `main` deploys on every push, so the portfolio entity and the importer went
 *  live before the split did. In that window a second portfolio would not have
 *  been a second record — it would have been the same mixed journal with a
 *  label on it, and the statistics wrong in a way nothing on screen could
 *  explain. One portfolio cannot mix with anything.
 *
 *  Lifted now that both halves are scoped: every screen reads one portfolio
 *  (lib/portfolio/scope, components/useScopedTrades) and so does the server —
 *  profile, patterns, hypothesis, weekly report and daily insight all key on
 *  the account. Behaviour stays across the journal on purpose: a habit belongs
 *  to the trader, not to the account.
 *
 *  Kept as a constant rather than deleted. It is the lever to pull if a future
 *  change reaches the analysis before it reaches the scoping again. */
export const STAGED_PORTFOLIO_CAP = Number.POSITIVE_INFINITY;

export function portfolioLimit(role: Role): number {
  return Math.min(PORTFOLIO_LIMIT[role] ?? 0, STAGED_PORTFOLIO_CAP);
}

export type AddVerdict =
  | { ok: true }
  | { ok: false; reason: 'plan' | 'staged'; limit: number; message: string };

/** Whether another portfolio may be created, and what to say when it may not.
 *
 *  The two refusals are different facts and must not share a message. "Your
 *  plan allows one" is answered by upgrading; "only one is supported yet" is
 *  not, and telling a Deluxe subscriber to upgrade would be nonsense. */
export function canAddPortfolio(current: number, role: Role): AddVerdict {
  const plan = PORTFOLIO_LIMIT[role] ?? 0;
  const effective = portfolioLimit(role);
  if (current < effective) return { ok: true };

  if (current >= plan) {
    return {
      ok: false, reason: 'plan', limit: plan,
      message: plan === 0
        ? 'חיבור תיק דורש מנוי פעיל.'
        : plan === 1
          ? 'במסלול הנוכחי אפשר לחבר תיק אחד.'
          : `במסלול הנוכחי אפשר לחבר עד ${plan} תיקים.`,
    };
  }
  return {
    ok: false, reason: 'staged', limit: effective,
    message: 'כרגע נתמך תיק אחד. ריבוי תיקים ייפתח כשהניתוח יופרד לכל תיק בנפרד.',
  };
}

// ── Normalizing what came out of storage ─────────────────────────────────────

/** The default zone. Israel, matching the app's own default clock. */
const FALLBACK_ZONE = 'Asia/Jerusalem';
/** Below this, a balance is a typo rather than an account. */
export const MIN_BALANCE_USD = 100;
export const MAX_NAME_LENGTH = 60;

/** Coerce a stored row into a portfolio, or reject it.
 *
 *  This list is user-editable, syncs across devices, and will outlive several
 *  versions of its own shape. Nothing here trusts what it is handed. */
export function normalizePortfolio(raw: unknown): Portfolio | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : typeof r.id === 'number' ? String(r.id) : '';
  if (!id) return null;

  const balance = Number(r.startingBalanceUsd);
  return {
    id,
    name: typeof r.name === 'string' ? r.name.trim().slice(0, MAX_NAME_LENGTH) : '',
    source: 'tradingview',
    timezone: typeof r.timezone === 'string' && r.timezone.trim() ? r.timezone.trim() : FALLBACK_ZONE,
    // A balance that is missing or nonsense becomes 0, NOT a default account
    // size. A silent 25,000 here is the exact bug the first-run setup exists
    // to prevent, reintroduced one layer down.
    startingBalanceUsd: Number.isFinite(balance) && balance > 0 ? balance : 0,
    createdAt: Number.isFinite(Number(r.createdAt)) ? Number(r.createdAt) : Date.now(),
    ...(Number.isFinite(Number(r.lastImportAt)) ? { lastImportAt: Number(r.lastImportAt) } : {}),
    ...(Number.isFinite(Number(r.lastActiveAt)) ? { lastActiveAt: Number(r.lastActiveAt) } : {}),
    ...(Number.isFinite(Number(r.updatedAt)) ? { updatedAt: Number(r.updatedAt) } : {}),
    ...(r.deleted === true ? { deleted: true as const } : {}),
  };
}

export function newPortfolio(name: string, startingBalanceUsd: number, timezone: string): Portfolio {
  const now = Date.now();
  return {
    id: `pf_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim().slice(0, MAX_NAME_LENGTH),
    source: 'tradingview',
    timezone,
    startingBalanceUsd,
    createdAt: now,
    updatedAt: now,
  };
}

export interface NameProblem { field: 'name' | 'balance'; message: string }

/** What is wrong with a portfolio the trader is about to create, if anything.
 *
 *  Returns every problem rather than the first: a form that reveals its
 *  objections one at a time is a form people fill in twice. */
export function validatePortfolio(
  name: string, balance: number, existing: readonly Portfolio[], selfId?: string,
): NameProblem[] {
  const out: NameProblem[] = [];
  const trimmed = name.trim();
  if (!trimmed) {
    out.push({ field: 'name', message: 'תן לתיק שם.' });
  } else if (existing.some(p => !p.deleted && p.id !== selfId && p.name.trim().toLowerCase() === trimmed.toLowerCase())) {
    // Two portfolios with one name is a switcher the trader cannot use.
    out.push({ field: 'name', message: 'כבר יש תיק בשם הזה.' });
  }
  if (!Number.isFinite(balance) || balance < MIN_BALANCE_USD) {
    out.push({ field: 'balance', message: `יתרת פתיחה חייבת להיות ${MIN_BALANCE_USD} דולר לפחות.` });
  }
  return out;
}

/** The portfolio a screen should show, given what is stored and what was last
 *  selected. Never returns a deleted one, and never returns nothing when
 *  something exists — a stale selection falls back to the oldest rather than
 *  leaving the app with no context. */
export function resolveSelected(
  portfolios: readonly Portfolio[], selectedId: string | null,
): Portfolio | null {
  const live = portfolios.filter(p => !p.deleted);
  if (live.length === 0) return null;
  return live.find(p => p.id === selectedId)
    ?? [...live].sort((a, b) => a.createdAt - b.createdAt)[0];
}
