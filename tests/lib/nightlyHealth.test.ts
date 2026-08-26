// "How long ago did the nightly run happen", and when that becomes a problem.
//
// The cron writes a record of every run and nothing read it, so the failure
// mode was silence: every screen kept rendering what the last good run
// produced, growing staler, with no symptom but the coach slowly having
// nothing new to say.
//
// The staleness threshold is the whole judgement in that surface. The cron
// runs daily, so a gap past two days means runs are being missed — and the
// line has to say so even when the last run it can see reported success.

import { describe, it, expect } from 'vitest';
import { __testing } from '../../app/components/NightlyHealth';

const { ago } = __testing;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe('ago', () => {
  it('reads a run from minutes ago as fresh', () => {
    expect(ago(hoursAgo(0.2))).toEqual({ text: 'לפני פחות משעה', stale: false });
  });

  it('counts hours within the first day', () => {
    expect(ago(hoursAgo(6))).toEqual({ text: 'לפני 6 שעות', stale: false });
  });

  it('calls the previous night yesterday, and does not call it stale', () => {
    // The normal state for most of the day: the run happened last night.
    expect(ago(hoursAgo(26))).toEqual({ text: 'אתמול', stale: false });
  });

  it('marks two days as stale', () => {
    // A daily cron that last ran two days ago has missed one. This is the
    // state that used to be invisible.
    const out = ago(hoursAgo(50));
    expect(out.stale).toBe(true);
    expect(out.text).toBe('לפני 2 ימים');
  });

  it('marks a long silence as stale', () => {
    expect(ago(hoursAgo(24 * 9)).stale).toBe(true);
  });

  it('does not flip to stale one hour past the boundary', () => {
    // 35 hours rounds to one day, and one missed hour is not a missed run.
    expect(ago(hoursAgo(35)).stale).toBe(false);
  });

  it('treats an unparseable timestamp as stale rather than as fine', () => {
    // A surface whose job is to report trouble must not report health when it
    // cannot read the input.
    expect(ago('not a date')).toEqual({ text: '—', stale: true });
  });
});
