// ─────────────────────────────────────────────────────────────────────────────
// The music panel's one piece of real logic: turning whatever the trader pasted
// into something safe to put in an iframe.
//
// This file exists because the alternative — dropping the pasted string into
// `<iframe src=...>` — hands an attacker the frame. Nothing here ever passes
// input through: it extracts an id, checks that id against a strict charset,
// and REBUILDS the URL from scratch. A string that does not parse produces
// null, and the panel refuses to play it.
// ─────────────────────────────────────────────────────────────────────────────

/** A video id is exactly 11 chars of the YouTube base64url alphabet. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Playlist ids vary by kind (PL…, RD…, UU…, OLAK5uy_…) but share the charset
 *  and are never long. The cap is what keeps a crafted "id" out of the URL. */
const LIST_ID = /^[A-Za-z0-9_-]{2,64}$/;

/** Hosts we accept a link from. Anything else is not a YouTube link, whatever
 *  it claims in its path — `evil.com/watch?v=…` must not resolve. */
const HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'music.youtube.com', 'youtu.be', 'www.youtu.be',
  'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);

export interface MusicRef {
  /** Present for a single track, absent for a playlist played from its start. */
  videoId?: string;
  /** Present when the link carried a playlist. */
  listId?: string;
}

/** Everything the panel stores about one entry in its recents. */
export interface MusicItem {
  ref: MusicRef;
  /** What to show in the list. A search result supplies the real title; a
   *  pasted link has none, so the id stands in until the player shows it. */
  label: string;
}

function fromPath(path: string): string | null {
  // /embed/ID, /live/ID, /shorts/ID, /v/ID, and youtu.be/ID
  const m = path.match(/^\/(?:embed|live|shorts|v)\/([^/?#]+)/) ?? path.match(/^\/([^/?#]+)$/);
  return m ? m[1] : null;
}

/**
 * Parse a pasted string into a playable reference, or null.
 *
 * Accepts a bare video id, a youtu.be link, any youtube.com watch/embed/live/
 * shorts/playlist URL, and music.youtube.com. A watch link that carries both a
 * video and a list keeps both, so "play this track, then the rest of the
 * playlist" survives the paste.
 */
export function parseYouTubeRef(input: string): MusicRef | null {
  const raw = (input ?? '').trim();
  if (!raw || raw.length > 2048) return null;

  // A bare id, which is what people paste more often than a URL.
  if (VIDEO_ID.test(raw)) return { videoId: raw };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;

  const listParam = url.searchParams.get('list');
  const listId = listParam && LIST_ID.test(listParam) ? listParam : undefined;

  const vParam = url.searchParams.get('v');
  let videoId = vParam && VIDEO_ID.test(vParam) ? vParam : undefined;

  if (!videoId) {
    const fromUrlPath = fromPath(url.pathname);
    if (fromUrlPath && VIDEO_ID.test(fromUrlPath)) videoId = fromUrlPath;
  }

  if (videoId) return listId ? { videoId, listId } : { videoId };
  if (listId)  return { listId };
  return null;
}

/**
 * The iframe src. Built only from ids that already passed the charset check —
 * never from the original string.
 *
 * youtube-nocookie is the privacy-preserving host: it does not set tracking
 * cookies until playback starts, and it is the only frame host the app's CSP
 * needs to allow.
 */
export function embedUrl(ref: MusicRef, autoplay = true): string | null {
  const params = new URLSearchParams({
    autoplay: autoplay ? '1' : '0',
    playsinline: '1',
    rel: '0',
  });

  if (ref.videoId) {
    if (!VIDEO_ID.test(ref.videoId)) return null;
    if (ref.listId) {
      if (!LIST_ID.test(ref.listId)) return null;
      params.set('list', ref.listId);
    }
    return `https://www.youtube-nocookie.com/embed/${ref.videoId}?${params}`;
  }

  if (ref.listId) {
    if (!LIST_ID.test(ref.listId)) return null;
    params.set('list', ref.listId);
    return `https://www.youtube-nocookie.com/embed/videoseries?${params}`;
  }

  return null;
}

/** Where "open on YouTube" goes. Same rule: rebuilt, never echoed. */
export function watchUrl(ref: MusicRef): string | null {
  if (ref.videoId && VIDEO_ID.test(ref.videoId)) {
    return `https://www.youtube.com/watch?v=${ref.videoId}`;
  }
  if (ref.listId && LIST_ID.test(ref.listId)) {
    return `https://www.youtube.com/playlist?list=${ref.listId}`;
  }
  return null;
}

/** Stable identity for de-duplicating the recents list. */
export function refKey(ref: MusicRef): string {
  return `${ref.videoId ?? ''}|${ref.listId ?? ''}`;
}

export function sameRef(a: MusicRef | null, b: MusicRef | null): boolean {
  if (!a || !b) return a === b;
  return refKey(a) === refKey(b);
}

/** A YouTube search page for text that was not a link — the escape hatch when
 *  in-app search has no API key behind it. */
export function searchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`;
}
