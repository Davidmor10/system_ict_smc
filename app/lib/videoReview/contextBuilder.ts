// Server-side context builder — gathers everything the report generator needs
// to reason about a trade beyond the video itself: the trade record, the
// trader's own rules and setups, recent aggregate stats, and any prior pattern
// memory. Every read is scoped by clerk_id. When Supabase isn't configured we
// return a minimal TraderContext built from the passed-in trade only, so the
// pipeline still runs end-to-end in local dev.

import { logger } from '../logger';
import { createServerSupabaseClient, isSupabaseConfigured } from '../supabase/server';
import { rowToTrade, type TradeRow } from '../../api/journal/route';
import { tradePnL } from '../journal';
import { loadPatterns } from './patternMemory';
import type { TraderContext } from './types';

/** Build the full context for a single trade. Never throws — a partial context
    is better than a failed review; the report prompt tolerates missing sections. */
export async function buildTraderContext(clerkId: string, tradeId: number): Promise<TraderContext | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = createServerSupabaseClient();

  const [tradeRow, rulesRow, setupsRow, recentRows, patterns] = await Promise.all([
    fetchTradeRow(supabase, clerkId, tradeId),
    fetchCollection(supabase, clerkId, 'rules'),
    fetchCollection(supabase, clerkId, 'setups'),
    fetchRecentTradeRows(supabase, clerkId),
    loadPatterns(clerkId),
  ]);

  if (!tradeRow) return null;
  const trade = rowToTrade(tradeRow);

  return {
    trade: {
      id: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      entry: trade.entry,
      stop: trade.stop,
      target: trade.target,
      result: trade.result,
      contracts: trade.contracts ?? 1,
      session: trade.session,
      setup: trade.setup ?? undefined,
      model: trade.model || undefined,
      notes: trade.notes || undefined,
      pnlUsd: trade.pnlUsd ?? null,
      tradeR: trade.tradeR ?? null,
      dateISO: trade.dateISO,
      time: trade.time,
    },
    rules: normalizeRules(rulesRow),
    setups: normalizeSetups(setupsRow),
    recentStats: computeRecentStats(recentRows),
    patterns,
  };
}

async function fetchTradeRow(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  clerkId: string,
  tradeId: number,
): Promise<TradeRow | null> {
  try {
    const { data, error } = await supabase
      .from('journal_trades')
      .select('*')
      .eq('clerk_id', clerkId)
      .eq('id', tradeId)
      .maybeSingle();
    if (error || !data) return null;
    return data as TradeRow;
  } catch (err) {
    logger.warn('contextBuilder: trade fetch failed', { tradeId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function fetchCollection(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  clerkId: string,
  kind: string,
): Promise<unknown> {
  try {
    const { data, error } = await supabase
      .from('user_collections')
      .select('data')
      .eq('clerk_id', clerkId)
      .eq('kind', kind)
      .maybeSingle();
    if (error || !data) return null;
    return data.data;
  } catch (err) {
    logger.warn('contextBuilder: collection fetch failed', { kind, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Recent trades for the 30-day rolling stats. Cap at 500 rows to keep this
    bounded even for very active traders. */
async function fetchRecentTradeRows(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  clerkId: string,
): Promise<TradeRow[]> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const { data, error } = await supabase
      .from('journal_trades')
      .select('*')
      .eq('clerk_id', clerkId)
      .gte('date_iso', cutoff)
      .is('deleted_at', null)
      .limit(500);
    if (error || !data) return [];
    return data as TradeRow[];
  } catch (err) {
    logger.warn('contextBuilder: recent trades fetch failed', { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

function normalizeRules(raw: unknown): TraderContext['rules'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .filter(r => !r.deleted)
    .map(r => ({
      id: String(r.id ?? ''),
      text: String(r.title ?? r.text ?? ''),
      active: r.isActive !== false,
    }))
    .filter(r => r.id && r.text);
}

function normalizeSetups(raw: unknown): TraderContext['setups'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .filter(s => !s.deleted)
    .map(s => ({
      id: String(s.id ?? ''),
      name: String(s.name ?? ''),
      description: typeof s.description === 'string' && s.description ? s.description : undefined,
    }))
    .filter(s => s.id && s.name);
}

function computeRecentStats(rows: TradeRow[]): TraderContext['recentStats'] {
  const trades = rows.map(rowToTrade).filter(t => t.result !== 'OPEN');
  if (trades.length === 0) {
    return { winRate30d: null, avgR30d: null, tradesCount30d: 0, profitableSessions: [] };
  }
  const wins = trades.filter(t => t.result === 'WIN').length;
  const rs = trades.map(t => t.tradeR).filter((r): r is number => typeof r === 'number');
  const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;

  // Per-session PnL — surface only the sessions where the trader is net-positive.
  const bySession: Record<string, number> = {};
  for (const t of trades) {
    const p = tradePnL(t);
    if (p === null || !t.session) continue;
    bySession[t.session] = (bySession[t.session] ?? 0) + p;
  }
  const profitableSessions = Object.entries(bySession)
    .filter(([, p]) => p > 0)
    .map(([s]) => s);

  return {
    winRate30d: Math.round((wins / trades.length) * 100),
    avgR30d: avgR !== null ? Math.round(avgR * 100) / 100 : null,
    tradesCount30d: trades.length,
    profitableSessions,
  };
}
