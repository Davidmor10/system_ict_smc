// ─────────────────────────────────────────────────────────────────────────────
// The bio, on its way into a prompt.
//
// The settings page has always described this field as something the coach
// reads. It did not: nothing outside the settings page ever opened the doc, so
// the trader wrote two sentences about who they are and every insight still met
// them as a stranger.
//
// Two rules govern the block now, and both are here because the failure mode is
// silent: an empty bio must produce an EMPTY string rather than a heading with
// "unknown" under it — a heading with nothing under it is an invitation to
// invent — and the block must state, in the prompt itself, that nothing in it
// outranks the journal. A bio is a claim; the trade log is evidence.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { buildTraderProfileBlock } from '../../app/lib/settings/server';
import { withDefaults, type UserSettings } from '../../app/lib/settings/types';

const S = (over: Partial<UserSettings> = {}): UserSettings => withDefaults(over);

describe('buildTraderProfileBlock', () => {
  it('is empty when there is no bio', () => {
    expect(buildTraderProfileBlock(S())).toBe('');
    expect(buildTraderProfileBlock(S({ bio: '   ' }))).toBe('');
    expect(buildTraderProfileBlock(null)).toBe('');
  });

  it('is empty when only the style was picked', () => {
    // The style is a dropdown with a default — on its own it is not something
    // the trader said, and a section built from it would be words about nobody.
    expect(buildTraderProfileBlock(S({ tradingStyle: 'scalper' }))).toBe('');
  });

  it('carries the trader own words once they have written any', () => {
    const block = buildTraderProfileBlock(S({ bio: 'סוחר NQ בסשן ניו יורק, שנתיים בשוק.' }));
    expect(block).toContain('סוחר NQ בסשן ניו יורק, שנתיים בשוק.');
    expect(block).toContain('their own words');
  });

  it('names the horizon in terms a model can act on', () => {
    expect(buildTraderProfileBlock(S({ bio: 'x', tradingStyle: 'scalper' })))
      .toContain('seconds to minutes');
    expect(buildTraderProfileBlock(S({ bio: 'x', tradingStyle: 'swing' })))
      .toContain('days to weeks');
  });

  it('tells the model the journal wins when the two disagree', () => {
    // The load-bearing sentence. Without it the model averages a self-flattering
    // bio against the numbers and reports the average as a finding.
    const block = buildTraderProfileBlock(S({ bio: 'אני סוחר ממושמע ורווחי.' }));
    expect(block).toContain('never as evidence');
    expect(block).toContain('the numbers are what happened');
  });

  it('forbids quoting it back as a finding', () => {
    const block = buildTraderProfileBlock(S({ bio: 'x' }));
    expect(block).toContain('Never quote this');
    expect(block).toContain('never mention that you were given it');
  });

  it('includes the nickname only when there is one', () => {
    expect(buildTraderProfileBlock(S({ bio: 'x', nickname: 'דיוויד' }))).toContain('דיוויד');
    expect(buildTraderProfileBlock(S({ bio: 'x' }))).not.toContain('Prefers to be called');
  });

  it('caps a bio that grew past the field limit', () => {
    // The input caps at 600, but a doc written by an older build or edited by
    // hand can carry more, and an essay here starts crowding out the facts
    // block it is supposed to sit beside.
    const block = buildTraderProfileBlock(S({ bio: 'א'.repeat(5000) }));
    expect(block.length).toBeLessThan(1500);
  });

  it('survives a style the type no longer knows', () => {
    const block = buildTraderProfileBlock(
      S({ bio: 'x', tradingStyle: 'algo' as UserSettings['tradingStyle'] }),
    );
    expect(block).toContain('closes every position the same day');   // the default horizon
  });
});
