import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { logger } from '../../../lib/logger';
import { requirePlanApi } from '../../../lib/withRoleCheck';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/music/search?q=… — search YouTube for something to play.
//
// The key lives here and never reaches the browser: the panel calls this route,
// this route calls Google. Without YOUTUBE_API_KEY the route answers 501 and
// the panel hides its search box and offers a plain YouTube link instead, so
// the feature degrades to "paste a link" rather than breaking.
//
// Quota note for whoever sets the key: a search costs 100 units against a
// default 10,000/day, so this is ~100 searches a day across all users. The rate
// limit below is the local guard; the real ceiling is Google's.
// ─────────────────────────────────────────────────────────────────────────────

const ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
const MAX_RESULTS = 8;
const TIMEOUT_MS = 8_000;

export interface MusicSearchResult {
  videoId: string;
  title: string;
  channel: string;
  thumb: string;
}

interface YouTubeItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
  };
}

export async function GET(req: Request) {
  // The dashboard is paid-only, and so is everything it can call.
  const denied = await requirePlanApi('starter', '/api/music/search');
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/music/search' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`music:search:${userId}`, 30, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/music/search', userId });
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 120);
  if (q.length < 2) return NextResponse.json({ results: [] });

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    // Not an error the user caused, and not something to retry — the panel
    // reads this and stops offering search for the rest of the session.
    return NextResponse.json({ error: 'not_configured', results: [] }, { status: 501 });
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  // An unembeddable result is a dead row in a panel that can only embed.
  url.searchParams.set('videoEmbeddable', 'true');
  url.searchParams.set('safeSearch', 'moderate');
  url.searchParams.set('maxResults', String(MAX_RESULTS));
  url.searchParams.set('q', q);
  url.searchParams.set('key', key);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

    if (!res.ok) {
      // Log the status, never the body or the URL — both can carry the key.
      logger.warn('youtube search failed', { status: res.status });
      const quota = res.status === 403;
      return NextResponse.json(
        { error: quota ? 'quota' : 'upstream', results: [] },
        { status: quota ? 429 : 502 },
      );
    }

    const data = (await res.json()) as { items?: YouTubeItem[] };
    const results: MusicSearchResult[] = (data.items ?? [])
      .map(item => ({
        videoId: item.id?.videoId ?? '',
        title: item.snippet?.title ?? '',
        channel: item.snippet?.channelTitle ?? '',
        thumb: item.snippet?.thumbnails?.default?.url ?? '',
      }))
      // A row without an id cannot be played, so it has no business being shown.
      .filter(r => /^[A-Za-z0-9_-]{11}$/.test(r.videoId) && r.title);

    return NextResponse.json({ results });
  } catch (err) {
    logger.warn('youtube search threw', { message: err instanceof Error ? err.message : 'unknown' });
    return NextResponse.json({ error: 'upstream', results: [] }, { status: 502 });
  }
}
