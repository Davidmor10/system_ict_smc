// Pattern memory — the running profile of a trader's recurring habits.
// Backed by user_collections (kind: 'pattern_memory_v1'), scoped by clerk_id
// like everything else. The report generator reads these as one more evidence
// source; after each report finishes, we ask a lightweight prompt to decide
// which patterns to add/increment.

import { genAI } from '../ai/client';
import { logger } from '../logger';
import { buildPatternExtractionPrompt } from './prompts';
import type { PatternMemoryEntry, TradeReviewReport } from './types';
import { createServerSupabaseClient, isSupabaseConfigured } from '../supabase/server';

export const PATTERN_KIND = 'pattern_memory_v1';

export async function loadPatterns(clerkId: string): Promise<PatternMemoryEntry[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from('user_collections')
      .select('data')
      .eq('clerk_id', clerkId)
      .eq('kind', PATTERN_KIND)
      .maybeSingle();
    if (error || !data) return [];
    const arr = data.data;
    return Array.isArray(arr) ? arr as PatternMemoryEntry[] : [];
  } catch (err) {
    logger.warn('pattern memory load failed', { clerkId, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

async function savePatterns(clerkId: string, patterns: PatternMemoryEntry[]): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase
      .from('user_collections')
      .upsert({ clerk_id: clerkId, kind: PATTERN_KIND, data: patterns }, { onConflict: 'clerk_id,kind' });
    if (error) throw error;
  } catch (err) {
    logger.warn('pattern memory save failed', { clerkId, error: err instanceof Error ? err.message : String(err) });
  }
}

/** After a report finishes, ask the model which patterns to update, then merge
    into the trader's memory. Never blocks the response — a failure here just
    means we don't learn from this trade, not that the trade review failed. */
export async function updateFromReport(
  clerkId: string,
  tradeId: number,
  report: TradeReviewReport,
): Promise<void> {
  const existing = await loadPatterns(clerkId);
  const prompt = buildPatternExtractionPrompt(JSON.stringify(report), existing);
  let updates: { patternKey: string; description: string; op: 'increment' | 'create' }[] = [];
  try {
    const result = await genAI.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });
    const text = result.text ?? '{}';
    const parsed = JSON.parse(text) as { updates?: typeof updates };
    if (Array.isArray(parsed.updates)) updates = parsed.updates.slice(0, 3);
  } catch (err) {
    logger.warn('pattern extraction failed', { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const now = Date.now();
  const byKey = new Map(existing.map(p => [p.patternKey, p]));

  for (const u of updates) {
    if (!u.patternKey || typeof u.patternKey !== 'string') continue;
    if (u.op === 'increment' && byKey.has(u.patternKey)) {
      const p = byKey.get(u.patternKey)!;
      if (!p.tradeIds.includes(tradeId)) {
        p.occurrences += 1;
        p.tradeIds = [...p.tradeIds, tradeId].slice(-50); // cap history
        p.lastSeenAt = now;
      }
    } else if (u.op === 'create' && !byKey.has(u.patternKey)) {
      byKey.set(u.patternKey, {
        id: `pat-${now}-${Math.random().toString(36).slice(2, 7)}`,
        clerkId,
        patternKey: u.patternKey,
        description: u.description ?? '',
        occurrences: 1,
        tradeIds: [tradeId],
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
  }

  await savePatterns(clerkId, [...byKey.values()]);
}
