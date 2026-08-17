// ─────────────────────────────────────────────────────────────────────────────
// Reading the trader's own words, server-side.
//
// The settings page has always had a bio field described as "the coach uses
// this to phrase advice". It did not. Nothing outside the settings page ever
// read the doc, so the trader wrote two sentences about who they are and the
// coach kept meeting them as a stranger every session.
//
// This is the read side of that promise. It is deliberately narrow: only the
// three fields that say something about the person — what they call themselves,
// how they describe their trading, and which style they picked — cross into a
// prompt. Their numbers never do. Every statistic the model is allowed to cite
// still comes from the computed facts block, because a bio is a claim and the
// journal is evidence, and the moment those two are in the same paragraph the
// model will average them.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerSupabaseClient, isSupabaseConfigured } from '../supabase/server';
import { SETTINGS_KIND, withDefaults, type TradingStyle, type UserSettings } from './types';
import { logger } from '../logger';

/** How each style reads to a model that has to pick a time horizon. */
const STYLE_EN: Record<TradingStyle, string> = {
  scalper:  'scalper — holds for seconds to minutes',
  day:      'day trader — closes every position the same day',
  swing:    'swing trader — holds for days to weeks',
  position: 'position trader — holds for weeks or longer',
};

/** Anything longer than this is not a bio, it is an essay, and it would start
 *  crowding out the facts block it is supposed to sit beside. The settings
 *  field caps input at 600; this is the backstop for a doc written by an older
 *  build or edited by hand. */
const MAX_BIO_CHARS = 600;

export interface TraderProfileContext {
  nickname: string;
  bio: string;
  tradingStyle: TradingStyle;
}

/** The trader's settings, or null when there is nothing stored or the read
 *  fails. Never throws: a missing bio must degrade the prompt, not the run. */
export async function getUserSettings(clerkId: string): Promise<UserSettings | null> {
  if (!clerkId || !isSupabaseConfigured()) return null;
  try {
    const { data, error } = await createServerSupabaseClient()
      .from('user_collections')
      .select('data')
      .eq('clerk_id', clerkId)
      .eq('kind', SETTINGS_KIND)
      .maybeSingle();
    if (error || !data?.data) return null;
    return withDefaults(data.data as Partial<UserSettings>);
  } catch (err) {
    logger.warn('settings read failed — continuing without the trader profile', {
      clerkId, error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** The block handed to a prompt, or '' when the trader has written nothing.
 *
 *  Empty is the honest default: an absent bio must produce an absent section,
 *  not a section saying "unknown". A heading with nothing under it invites the
 *  model to fill the gap, which is the exact failure this system spends most of
 *  its rules preventing. */
export function buildTraderProfileBlock(settings: UserSettings | null): string {
  if (!settings) return '';

  const bio = (settings.bio ?? '').trim().slice(0, MAX_BIO_CHARS);
  const nickname = (settings.nickname ?? '').trim();
  const style = STYLE_EN[settings.tradingStyle] ?? STYLE_EN.day;

  // The style alone is a dropdown default, not something the trader said. On
  // its own it is not worth a section; with a bio it is useful context.
  if (!bio) return '';

  const lines = [
    'WHO THIS TRADER SAYS THEY ARE — their own words, written in settings.',
    'Treat this as background, never as evidence:',
    `- Self-description: ${bio}`,
    `- Trading style they identify with: ${style}`,
  ];
  if (nickname) lines.push(`- Prefers to be called: ${nickname}`);
  lines.push(
    'Use it to pitch the level and the horizon of what you say — a scalper and a',
    'swing trader need different framing for the same number. Do NOT treat any',
    'claim in it as a fact about their results: if they say they are profitable',
    'and the numbers disagree, the numbers are what happened. Never quote this',
    'back to them as a finding, and never mention that you were given it.',
  );
  return lines.join('\n');
}

/** Convenience: read and render in one call. */
export async function traderProfileBlock(clerkId: string): Promise<string> {
  return buildTraderProfileBlock(await getUserSettings(clerkId));
}
