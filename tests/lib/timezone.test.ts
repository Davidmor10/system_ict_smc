// ─────────────────────────────────────────────────────────────────────────────
// The clock the app runs on.
//
// The old settings field was a text box: it accepted any string, stored it,
// displayed it back, and was read by absolutely nothing — so it could say
// "New York" while every session window, every "today", and every date stamp
// still resolved against Asia/Jerusalem. Two things have to be true now, and
// they are what this file pins:
//
//   1. Only a real zone can be stored. Free text does not become a timezone by
//      being typed into a timezone field.
//   2. An existing account is migrated, not reset. The doc every current user
//      has says "Israel (Asia/Jerusalem)" — a label, not an id — and reading
//      the id out of it is the difference between keeping their setting and
//      silently overwriting it.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEZONE, ZONES, hourFloatInZone, isValidZone, resolveZone,
  todayISOInZone, zoneAbbreviation, zoneShortName,
} from '../../app/lib/time/zone';
import { DEFAULT_SETTINGS, withDefaults } from '../../app/lib/settings/types';

describe('resolveZone', () => {
  it('keeps a real IANA id', () => {
    expect(resolveZone('America/New_York')).toBe('America/New_York');
    expect(resolveZone('Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(resolveZone('UTC')).toBe('UTC');
  });

  it('reads the id out of the label the old field shipped with', () => {
    // This is the string in every settings doc written before the picker.
    expect(resolveZone('Israel (Asia/Jerusalem)')).toBe('Asia/Jerusalem');
    expect(resolveZone('New York (America/New_York)')).toBe('America/New_York');
  });

  it('accepts a valid zone the curated list does not happen to offer', () => {
    expect(resolveZone('Europe/Madrid')).toBe('Europe/Madrid');
  });

  it('falls back to Israel for the free text the old field allowed', () => {
    // The whole point: "Mars" was storable and would have been shown back as
    // if it meant something.
    for (const junk of ['Mars', 'שעון ישראל', 'GMT+3ish', '   ', 'Asia/Nowhere']) {
      expect(resolveZone(junk)).toBe(DEFAULT_TIMEZONE);
    }
  });

  it('falls back for an absent value', () => {
    expect(resolveZone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(resolveZone(null)).toBe(DEFAULT_TIMEZONE);
    expect(resolveZone('')).toBe(DEFAULT_TIMEZONE);
  });
});

describe('the offered zones', () => {
  it('are all real — every one resolves in Intl', () => {
    // A curated list is only safe while every entry is genuine; one typo here
    // and the picker offers a value that throws on the next date format.
    for (const z of ZONES) expect(isValidZone(z.id)).toBe(true);
  });

  it('leads with Israel, which is the default', () => {
    expect(ZONES[0].id).toBe(DEFAULT_TIMEZONE);
    expect(DEFAULT_SETTINGS.timezone).toBe(DEFAULT_TIMEZONE);
  });

  it('has no duplicate ids', () => {
    expect(new Set(ZONES.map(z => z.id)).size).toBe(ZONES.length);
  });
});

describe('the clock actually differs by zone', () => {
  // A fixed instant: 2026-08-17T23:30:00Z. Israel is UTC+3 in August, so it is
  // already the 18th there while New York is still on the 17th at 19:30.
  const at = new Date('2026-08-17T23:30:00Z');

  it('gives each zone its own date', () => {
    expect(todayISOInZone('Asia/Jerusalem', at)).toBe('2026-08-18');
    expect(todayISOInZone('America/New_York', at)).toBe('2026-08-17');
    expect(todayISOInZone('UTC', at)).toBe('2026-08-17');
  });

  it('gives each zone its own hour', () => {
    expect(hourFloatInZone('Asia/Jerusalem', at)).toBeCloseTo(2.5, 5);
    expect(hourFloatInZone('America/New_York', at)).toBeCloseTo(19.5, 5);
    expect(hourFloatInZone('UTC', at)).toBeCloseTo(23.5, 5);
  });

  it('handles the half-hour offsets that catch naive arithmetic', () => {
    expect(hourFloatInZone('Asia/Kolkata', at)).toBeCloseTo(5, 5);
  });

  it('reports the zone abbreviation so the picker can prove the change took', () => {
    expect(zoneAbbreviation('UTC', at)).toBeTruthy();
  });

  it('prints IDT/IST for Israel rather than the GMT+3 that Intl returns', () => {
    // Every engine this app runs on answers "GMT+3" for Asia/Jerusalem, and a
    // clock reading "21:55 GMT+3" is not what the page is written around.
    const august = new Date('2026-08-17T12:00:00Z');   // +3, daylight
    const january = new Date('2026-01-17T12:00:00Z');  // +2, standard
    expect(zoneShortName('Asia/Jerusalem', august)).toBe('IDT');
    expect(zoneShortName('Asia/Jerusalem', january)).toBe('IST');
  });

  it('leaves every other zone to Intl', () => {
    expect(zoneShortName('UTC', at)).toBe(zoneAbbreviation('UTC', at));
  });
});

describe('migrating an existing settings doc', () => {
  it('carries the old label forward instead of resetting to the default', () => {
    const migrated = withDefaults({ timezoneLabel: 'New York (America/New_York)' });
    expect(migrated.timezone).toBe('America/New_York');
  });

  it('leaves an already-migrated doc alone', () => {
    const doc = withDefaults({ timezone: 'Asia/Tokyo', timezoneLabel: 'Israel (Asia/Jerusalem)' });
    expect(doc.timezone).toBe('Asia/Tokyo');
  });

  it('defaults a doc that never had the field', () => {
    expect(withDefaults({}).timezone).toBe(DEFAULT_TIMEZONE);
    expect(withDefaults(null).timezone).toBe(DEFAULT_TIMEZONE);
  });

  it('does not resurrect the notification toggles that were removed', () => {
    // They had zero readers — four switches wired to nothing. An old doc still
    // carries them; the type no longer claims they mean anything.
    expect('guardianEnabled' in DEFAULT_SETTINGS).toBe(false);
    expect('dailyPlanReminder' in DEFAULT_SETTINGS).toBe(false);
  });
});
