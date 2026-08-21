// ─────────────────────────────────────────────────────────────────────────────
// What the music panel is allowed to put in an iframe.
//
// The panel plays whatever the trader pastes, which means a string from outside
// the app reaches an iframe src. The rule that keeps that safe is that no input
// is ever forwarded: an id is extracted, checked against a fixed charset, and
// the URL is rebuilt. These tests pin both halves — the shapes that must parse,
// and the ones that must not.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  embedUrl, parseYouTubeRef, refKey, sameRef, searchUrl, watchUrl,
} from '../../app/lib/music';

const ID = 'dQw4w9WgXcQ';          // 11 chars, the canonical shape
const LIST = 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI';

describe('parseYouTubeRef — the shapes people actually paste', () => {
  it('takes a bare id', () => {
    expect(parseYouTubeRef(ID)).toEqual({ videoId: ID });
    expect(parseYouTubeRef(`  ${ID}  `)).toEqual({ videoId: ID });
  });

  it('takes a watch link', () => {
    expect(parseYouTubeRef(`https://www.youtube.com/watch?v=${ID}`)).toEqual({ videoId: ID });
    expect(parseYouTubeRef(`http://youtube.com/watch?v=${ID}&t=42s`)).toEqual({ videoId: ID });
  });

  it('takes a short link, an embed, a live and a short', () => {
    expect(parseYouTubeRef(`https://youtu.be/${ID}`)).toEqual({ videoId: ID });
    expect(parseYouTubeRef(`https://www.youtube.com/embed/${ID}`)).toEqual({ videoId: ID });
    expect(parseYouTubeRef(`https://www.youtube.com/live/${ID}`)).toEqual({ videoId: ID });
    expect(parseYouTubeRef(`https://www.youtube.com/shorts/${ID}`)).toEqual({ videoId: ID });
  });

  it('takes YouTube Music, which is where a music link usually comes from', () => {
    expect(parseYouTubeRef(`https://music.youtube.com/watch?v=${ID}`)).toEqual({ videoId: ID });
  });

  it('takes a playlist on its own', () => {
    expect(parseYouTubeRef(`https://www.youtube.com/playlist?list=${LIST}`)).toEqual({ listId: LIST });
  });

  it('keeps BOTH when the link carries a track inside a playlist', () => {
    // Dropping the list here would silently turn "play this album from track 4"
    // into "play track 4 and stop".
    expect(parseYouTubeRef(`https://www.youtube.com/watch?v=${ID}&list=${LIST}`))
      .toEqual({ videoId: ID, listId: LIST });
  });

  it('survives a link pasted without its scheme', () => {
    expect(parseYouTubeRef(`youtu.be/${ID}`)).toEqual({ videoId: ID });
  });
});

describe('parseYouTubeRef — what must never parse', () => {
  it('refuses another host wearing a YouTube path', () => {
    // The whole point of the host allowlist.
    expect(parseYouTubeRef(`https://evil.example/watch?v=${ID}`)).toBeNull();
    expect(parseYouTubeRef(`https://youtube.com.evil.example/watch?v=${ID}`)).toBeNull();
  });

  it('refuses a javascript: or data: payload', () => {
    expect(parseYouTubeRef('javascript:alert(1)')).toBeNull();
    expect(parseYouTubeRef('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('refuses an id of the wrong length or charset', () => {
    expect(parseYouTubeRef('short')).toBeNull();
    expect(parseYouTubeRef('waaaaaaytoolongforanid')).toBeNull();
    expect(parseYouTubeRef('abcdefghij!')).toBeNull();
  });

  it('refuses empty, junk and absurdly long input', () => {
    expect(parseYouTubeRef('')).toBeNull();
    expect(parseYouTubeRef('   ')).toBeNull();
    expect(parseYouTubeRef('play something nice')).toBeNull();
    expect(parseYouTubeRef('x'.repeat(5000))).toBeNull();
  });

  it('drops a list parameter that is not a plausible list id', () => {
    const ref = parseYouTubeRef(`https://www.youtube.com/watch?v=${ID}&list=${'z'.repeat(200)}`);
    expect(ref).toEqual({ videoId: ID });
  });
});

describe('embedUrl — rebuilt, never echoed', () => {
  it('frames a single track on the no-cookie host', () => {
    const url = embedUrl({ videoId: ID })!;
    expect(url.startsWith(`https://www.youtube-nocookie.com/embed/${ID}?`)).toBe(true);
    expect(url).toContain('autoplay=1');
    expect(url).toContain('playsinline=1');
  });

  it('frames a playlist through videoseries', () => {
    const url = embedUrl({ listId: LIST })!;
    expect(url.startsWith('https://www.youtube-nocookie.com/embed/videoseries?')).toBe(true);
    expect(url).toContain(`list=${LIST}`);
  });

  it('can be built without autoplay', () => {
    expect(embedUrl({ videoId: ID }, false)).toContain('autoplay=0');
  });

  it('returns null for a ref that was tampered with after parsing', () => {
    // A ref can reach this function from localStorage, which the user can edit.
    // The charset check has to happen here too, not only at parse time.
    expect(embedUrl({ videoId: 'javascript:x' })).toBeNull();
    expect(embedUrl({ videoId: `${ID}"><script>` })).toBeNull();
    expect(embedUrl({ listId: 'a b c' })).toBeNull();
    expect(embedUrl({})).toBeNull();
  });
});

describe('watchUrl', () => {
  it('points at the track, or at the playlist when there is no track', () => {
    expect(watchUrl({ videoId: ID })).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(watchUrl({ listId: LIST })).toBe(`https://www.youtube.com/playlist?list=${LIST}`);
  });

  it('refuses a tampered ref', () => {
    expect(watchUrl({ videoId: '../../evil' })).toBeNull();
    expect(watchUrl({})).toBeNull();
  });
});

describe('identity helpers', () => {
  it('treats the same track in the same playlist as one entry', () => {
    expect(sameRef({ videoId: ID, listId: LIST }, { videoId: ID, listId: LIST })).toBe(true);
  });

  it('treats a track alone and the same track in a playlist as different', () => {
    // They play differently, so recents should hold both.
    expect(sameRef({ videoId: ID }, { videoId: ID, listId: LIST })).toBe(false);
    expect(refKey({ videoId: ID })).not.toBe(refKey({ videoId: ID, listId: LIST }));
  });

  it('handles nulls without throwing', () => {
    expect(sameRef(null, null)).toBe(true);
    expect(sameRef(null, { videoId: ID })).toBe(false);
  });
});

describe('searchUrl', () => {
  it('escapes the query, including Hebrew and spaces', () => {
    expect(searchUrl('lofi hip hop')).toBe('https://www.youtube.com/results?search_query=lofi%20hip%20hop');
    expect(searchUrl(' שיר ')).toContain('search_query=%D7%A9%D7%99%D7%A8');
  });
});
