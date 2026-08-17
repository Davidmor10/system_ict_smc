// ─────────────────────────────────────────────────────────────────────────────
// The playbook — a trader's own setups, and how they have actually performed.
//
// This module owns the shape and the arithmetic. It is shared rather than local
// to the page because two other places already depend on it: the trade form
// offers these setups as the trade's model, and the recycle bin needs the
// tombstones the sync layer keeps. A second definition of "what a setup is"
// would drift from this one silently.
//
// THE LINK TO THE JOURNAL IS THE NAME
//
// A trade records `model: string`, and the trade form fills it from this list.
// So a setup's performance is "every trade whose model equals this setup's
// name" — which also means renaming a setup detaches its history. That is a
// real property of the current data model, not an oversight here; `renameCost`
// exists so the UI can warn about it instead of the trader discovering it.
// ─────────────────────────────────────────────────────────────────────────────

import { rMultiple, tradePnL, type TradeEntry } from './journal';
import type { InstrumentKey } from './instruments';
import type { SessionKey } from './sessions';

export const PLAYBOOK_STORAGE_KEY = 'onyx_playbook';
export const PLAYBOOK_COLLECTION = 'setups';

/** Confidence the trader places in the setup. Ordered, and the order is the
 *  default sort — see `gradeRank`. */
export type Grade = 'A+' | 'A' | 'B' | 'C';
export const GRADES: readonly Grade[] = ['A+', 'A', 'B', 'C'];

/** Where the setup stands right now. Stored as a stable key, never as the
 *  Hebrew label: a copy edit to the label must not orphan every stored row. */
export type SetupStatus = 'active' | 'testing' | 'paused';
export const STATUSES: readonly SetupStatus[] = ['active', 'testing', 'paused'];
export const STATUS_HE: Record<SetupStatus, string> = {
  active: 'פעיל', testing: 'בבדיקה', paused: 'מושהה',
};

/** LONG and SHORT match TradeEntry.direction exactly; BOTH is the setup-only
 *  third case (a setup can be two-directional, a trade cannot). */
export type SetupDirection = 'LONG' | 'SHORT' | 'BOTH';
export const DIRECTIONS: readonly SetupDirection[] = ['LONG', 'SHORT', 'BOTH'];
export const DIRECTION_HE: Record<SetupDirection, string> = {
  LONG: 'לונג', SHORT: 'שורט', BOTH: 'דו-כיווני',
};

export interface ChecklistItem {
  text: string;
  /** Required items gate the "ready to trade" state; optional ones are notes. */
  required: boolean;
}

export interface Setup {
  id: string;
  name: string;
  /** One line: when this setup is relevant. (Named `description` because that
   *  is what every stored row already calls it.) */
  description: string;
  /** Free prose: structure, area of interest, trigger, management, exit. */
  howItWorks: string;
  checklist: ChecklistItem[];
  tags: string[];
  grade: Grade;
  /** Instruments the setup is traded on. An array, not a string, so it can be
   *  compared against a trade's `symbol` instead of substring-matched. */
  assets: InstrumentKey[];
  direction: SetupDirection;
  /** Session keys, not Hebrew labels — same reason as `status`, plus these
   *  have to match TradeEntry.session to be filterable against real trades. */
  sessions: SessionKey[];
  status: SetupStatus;
  pinned: boolean;

  // ── Sync metadata (see lib/sync/merge.ts) ─────────────────────────────────
  updatedAt?: number;
  /** Soft delete. A tombstone, so the delete propagates across devices instead
   *  of a peer resurrecting the row on next merge. */
  deleted?: boolean;
  /** Emptied from the recycle bin. Still a tombstone — deleting the row
   *  outright would let another device's untombstoned copy bring it back — but
   *  no longer offered for restore. */
  purged?: boolean;
}

export function emptySetup(): Setup {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '', description: '', howItWorks: '',
    checklist: [], tags: [],
    grade: 'B', assets: [], direction: 'BOTH', sessions: [],
    status: 'active', pinned: false,
  };
}

/** Fill in everything a row stored by an older version of the page is missing.
 *
 *  The playbook predates every field below `checklist`, so most stored rows
 *  have none of them, and a card that reads `setup.sessions.length` on one of
 *  those would throw on the trader's own data. Defaults are chosen to be
 *  invisible: no grade claim (B), no filter membership, active. */
export function normalizeSetup(raw: unknown): Setup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' && typeof r.id !== 'number') return null;

  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

  return {
    id:   String(r.id),
    name: typeof r.name === 'string' ? r.name : '',
    description: typeof r.description === 'string' ? r.description : '',
    howItWorks:  typeof r.howItWorks === 'string' ? r.howItWorks : '',
    checklist: Array.isArray(r.checklist)
      ? r.checklist
          .map(c => {
            // Older rows stored a bare string per item; newer ones store
            // { text, required }. Both have to survive the read.
            if (typeof c === 'string') return { text: c, required: true };
            if (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string') {
              return { text: (c as { text: string }).text, required: (c as { required?: unknown }).required !== false };
            }
            return null;
          })
          .filter((c): c is ChecklistItem => c !== null && c.text.trim() !== '')
      : [],
    tags: strList(r.tags),
    grade:  GRADES.includes(r.grade as Grade) ? (r.grade as Grade) : 'B',
    assets: strList(r.assets) as InstrumentKey[],
    direction: DIRECTIONS.includes(r.direction as SetupDirection) ? (r.direction as SetupDirection) : 'BOTH',
    sessions: strList(r.sessions) as SessionKey[],
    status: STATUSES.includes(r.status as SetupStatus) ? (r.status as SetupStatus) : 'active',
    pinned: r.pinned === true,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : undefined,
    deleted: r.deleted === true,
    purged:  r.purged === true,
  };
}

export function gradeRank(g: Grade): number {
  return { 'A+': 4, 'A': 3, 'B': 2, 'C': 1 }[g] ?? 0;
}

// ── Performance ─────────────────────────────────────────────────────────────

export interface SetupStats {
  /** Every trade attributed to the setup, including still-open ones. */
  trades: number;
  /** WIN + LOSS. BE and OPEN are excluded — a break-even is neither, and an
   *  open position has not finished happening. */
  decided: number;
  /** Percent over `decided`, or null when nothing has been decided yet. Null
   *  rather than 0, because "no trades" and "never won" must not render the
   *  same. */
  winRate: number | null;
  /** Average REALIZED R. `rMultiple`, not the planned reward-to-risk — a trade
   *  planned for 3R and closed at +0.4R returned 0.4R, and showing the plan
   *  here would make every setup look like its own best case. */
  avgR: number | null;
  /** Realized dollars over closed trades. */
  pnl: number;
  /** Most recent trade date (YYYY-MM-DD), or null. */
  lastTradeISO: string | null;
}

export const EMPTY_STATS: SetupStats = {
  trades: 0, decided: 0, winRate: null, avgR: null, pnl: 0, lastTradeISO: null,
};

/** Stats for one already-selected slice of trades. */
export function statsForTrades(trades: readonly TradeEntry[]): SetupStats {
  if (trades.length === 0) return EMPTY_STATS;

  const closed  = trades.filter(t => t.result !== 'OPEN');
  const wins    = closed.filter(t => t.result === 'WIN').length;
  const losses  = closed.filter(t => t.result === 'LOSS').length;
  const decided = wins + losses;

  const rs = closed
    .map(rMultiple)
    .filter((r): r is number => typeof r === 'number' && Number.isFinite(r));

  const pnl = closed.reduce((sum, t) => sum + (tradePnL(t) ?? 0), 0);

  const dates = trades.map(t => t.dateISO).filter(Boolean).sort();

  return {
    trades:  trades.length,
    decided,
    winRate: decided > 0 ? (wins / decided) * 100 : null,
    avgR:    rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    pnl,
    lastTradeISO: dates.length ? dates[dates.length - 1] : null,
  };
}

/** Stats for every setup name present in the trade log, keyed by that name.
 *
 *  Built once per render pass rather than filtering the whole journal per card:
 *  a trader with a long history and a dozen setups would otherwise walk the
 *  full log a dozen times on every keystroke in the search box. */
export function statsBySetupName(trades: readonly TradeEntry[]): Map<string, SetupStats> {
  const buckets = new Map<string, TradeEntry[]>();
  for (const t of trades) {
    const key = (t.model ?? '').trim();
    if (!key) continue;
    const b = buckets.get(key);
    if (b) b.push(t); else buckets.set(key, [t]);
  }
  const out = new Map<string, SetupStats>();
  for (const [name, ts] of buckets) out.set(name, statsForTrades(ts));
  return out;
}

/** How many logged trades would lose their link if this setup were renamed.
 *
 *  Attribution is by name, so a rename is a detach. The trader is entitled to
 *  know that before they confirm it rather than after. */
export function renameCost(stats: Map<string, SetupStats>, currentName: string): number {
  return stats.get(currentName.trim())?.trades ?? 0;
}

// ── Filtering + sorting ─────────────────────────────────────────────────────

export type SortKey = 'grade' | 'win' | 'r' | 'trades';

export interface SetupFilter {
  query: string;
  asset: InstrumentKey | 'all';
  session: SessionKey | 'all';
  status: SetupStatus | 'all';
  sort: SortKey;
}

export const DEFAULT_FILTER: SetupFilter = {
  query: '', asset: 'all', session: 'all', status: 'all', sort: 'grade',
};

/** True when the setup should survive the current filter.
 *
 *  An empty `assets` or `sessions` means "not specified", which is treated as
 *  matching nothing once that filter is narrowed — the alternative (matching
 *  everything) makes a filter that appears to do nothing on a playbook where
 *  most setups predate the field. */
function matches(s: Setup, f: SetupFilter): boolean {
  if (f.asset !== 'all' && !s.assets.includes(f.asset)) return false;
  if (f.session !== 'all' && !s.sessions.includes(f.session)) return false;
  if (f.status !== 'all' && s.status !== f.status) return false;

  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  return [s.name, s.description, s.howItWorks, ...s.tags]
    .join(' ').toLowerCase().includes(q);
}

/** Filter, sort, then float the pinned ones to the top.
 *
 *  Pinning is applied last and as a stable partition, so within the pinned
 *  group the chosen sort still holds — a pin changes where a setup sits, not
 *  how the list is ordered. */
export function visibleSetups(
  setups: readonly Setup[],
  stats: Map<string, SetupStats>,
  f: SetupFilter,
): Setup[] {
  const stat = (s: Setup) => stats.get(s.name.trim()) ?? EMPTY_STATS;
  // A setup with nothing decided sorts below every setup that has a number,
  // rather than above them as a 0 would.
  const low = -Infinity;

  const by: Record<SortKey, (a: Setup, b: Setup) => number> = {
    grade:  (a, b) => gradeRank(b.grade) - gradeRank(a.grade) || (stat(b).avgR ?? low) - (stat(a).avgR ?? low),
    win:    (a, b) => (stat(b).winRate ?? low) - (stat(a).winRate ?? low),
    r:      (a, b) => (stat(b).avgR ?? low) - (stat(a).avgR ?? low),
    trades: (a, b) => stat(b).trades - stat(a).trades,
  };

  const list = setups.filter(s => matches(s, f)).sort(by[f.sort]);
  return [...list.filter(s => s.pinned), ...list.filter(s => !s.pinned)];
}
