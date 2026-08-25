// ─────────────────────────────────────────────────────────────────────────────
// What the tracked-behaviour sentence is allowed to say.
//
// These lines are the only text in the product that could be read as telling
// someone how to trade, and they are printed on the dashboard. They used to be
// commands — "set a target and a stop before entry and exit only at one of
// them", and worst of all "if there is no confirmation to log, don't enter",
// which is a direct instruction about whether to take a trade.
//
// Every one of them now names a field the trader fills in themselves and says
// it will be counted. The system originates no instruction: it measures a
// decision the trader already makes. This file is what keeps it that way.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { designExperiment } from '../../app/lib/coach-pipeline/behavior/experiment';
import type { BehaviorKind } from '../../app/lib/coach-pipeline/behavior/behaviors';

const KINDS: BehaviorKind[] = [
  'discretionary_exit', 'no_confirmation', 'rule_violation', 'size_spike', 'stop_widened',
];

const sentences = KINDS.map(k => ({ kind: k, text: designExperiment(k, 0.5, null).instruction }));

/** Imperatives, and anything that decides a trade for the reader. */
const COMMANDS = [
  'אל תיכנס', 'תיכנס', 'קבע ', 'החזק ', 'הגדל', 'הקטן', 'מכור', 'קנה',
  'אתה חייב', 'אתה צריך', 'חובה',
];

describe('the tracked-behaviour sentence', () => {
  it('is phrased as a measurement, not an instruction', () => {
    for (const { kind, text } of sentences) {
      expect(`${kind}: ${text}`).toContain('נעקוב');
    }
  });

  it('contains no command and no decision about a trade', () => {
    for (const { kind, text } of sentences) {
      for (const c of COMMANDS) {
        expect(`${kind} -> ${text}`).not.toContain(c);
      }
    }
  });

  it('never names an instrument, a direction, a price or a size', () => {
    // Process only. The moment one of these appears the sentence stops being
    // about the trader's own record and starts being about the market.
    for (const { kind, text } of sentences) {
      expect(`${kind} -> ${text}`).not.toMatch(/\b(ES|NQ|MES|MNQ)\b|לונג|שורט|מחיר/);
    }
  });

  it('covers every behaviour the layer can track', () => {
    expect(sentences).toHaveLength(5);
    expect(sentences.every(s => s.text.trim().length > 0)).toBe(true);
  });
});
