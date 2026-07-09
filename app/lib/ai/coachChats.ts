// ─────────────────────────────────────────────────────────────────────────────
// Persistence for the Chat Coach's multi-session chats. Each chat is one row in
// coach_chats with its full message list stored as jsonb (same convention as
// weekly_ai_reports.narrative — a structured blob in a jsonb column). Every
// query is scoped by clerk_id: the service-role client bypasses RLS by design,
// so this scoping IS the access control (see supabase-migration.sql).
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatTurn } from './chatPrompt';

/** Hard cap so a runaway chat can't bloat a single jsonb row. Oldest turns drop
    first; the coach only ever reads the last few turns for context anyway. */
const MAX_STORED_TURNS = 100;
const DEFAULT_TITLE = 'שיחה חדשה';

export interface CoachChatSummary { id: string; title: string; updatedAt: string; }
export interface CoachChatFull { id: string; title: string; messages: ChatTurn[]; }

/** A chat's title is just its first user message, trimmed — enough to recognize
    it in the "אחרונים" list without a separate naming step. */
export function deriveChatTitle(firstUserMessage: string): string {
  const clean = firstUserMessage.trim().replace(/\s+/g, ' ');
  if (!clean) return DEFAULT_TITLE;
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean;
}

/** The "אחרונים" list — summaries only (no message bodies), newest first. */
export async function listCoachChats(supabase: SupabaseClient, clerkId: string): Promise<CoachChatSummary[]> {
  const { data } = await supabase
    .from('coach_chats')
    .select('id, title, updated_at')
    .eq('clerk_id', clerkId)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (!data) return [];
  return data.map(r => ({ id: r.id as string, title: (r.title as string) || DEFAULT_TITLE, updatedAt: r.updated_at as string }));
}

export async function getCoachChat(supabase: SupabaseClient, clerkId: string, chatId: string): Promise<CoachChatFull | null> {
  const { data } = await supabase
    .from('coach_chats')
    .select('id, title, messages')
    .eq('clerk_id', clerkId)
    .eq('id', chatId)
    .maybeSingle();
  if (!data) return null;
  const messages = Array.isArray(data.messages)
    ? (data.messages as unknown[]).filter((m): m is ChatTurn =>
        !!m && typeof (m as ChatTurn).content === 'string' &&
        ((m as ChatTurn).role === 'user' || (m as ChatTurn).role === 'assistant'))
    : [];
  return { id: data.id as string, title: (data.title as string) || DEFAULT_TITLE, messages };
}

/** Creates a new chat row and returns its id. Title is derived from the first
    message so the list entry is meaningful from the very first turn. */
export async function createCoachChat(supabase: SupabaseClient, clerkId: string, firstUserMessage: string): Promise<string | null> {
  const { data } = await supabase
    .from('coach_chats')
    .insert({ clerk_id: clerkId, title: deriveChatTitle(firstUserMessage), messages: [] })
    .select('id')
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/** Replaces a chat's message list (capped) and bumps updated_at, scoped by
    clerk_id so a user can only ever write their own chats. */
export async function saveCoachChatMessages(supabase: SupabaseClient, clerkId: string, chatId: string, messages: ChatTurn[]): Promise<void> {
  await supabase
    .from('coach_chats')
    .update({ messages: messages.slice(-MAX_STORED_TURNS), updated_at: new Date().toISOString() })
    .eq('clerk_id', clerkId)
    .eq('id', chatId);
}

export async function deleteCoachChat(supabase: SupabaseClient, clerkId: string, chatId: string): Promise<void> {
  await supabase.from('coach_chats').delete().eq('clerk_id', clerkId).eq('id', chatId);
}
