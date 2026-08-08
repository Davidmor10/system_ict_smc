import { describe, expect, it } from 'vitest';
import {
  SYSTEM_PROMPT,
  GEMINI_STRICT_ADDENDUM,
  DAILY_INSIGHT_PROMPT_VERSION,
  buildUserMessage,
} from '../../app/lib/coach-pipeline/prompts/dailyInsight';
import { __internals } from '../../app/lib/coach-pipeline/pipelines/generateDailyInsight';
import type { TradeRow, UserProfileRow } from '../../app/lib/coach-pipeline/types';
import { computeTodaySignals } from '../../app/lib/coach-pipeline/analyzers/todaySignals';

// ── Fixtures ────────────────────────────────────────────────────────────────

let idCounter = 0;
function T(overrides: Partial<TradeRow> = {}): TradeRow {
  idCounter += 1;
  return {
    clerk_id:              'user_test',
    id:                    `t${idCounter}`,
    created_at:            '2026-08-15T09:00:00Z',
    updated_at:            '2026-08-15T09:00:00Z',
    deleted_at:            null,
    date:                  '2026-08-15',
    time:                  '10:00',
    symbol:                'ES',
    direction:             'LONG',
    contracts:             1,
    entry_price:           5000,
    stop_loss:             4990,
    take_profit:           5020,
    exit_price:            5020,
    exits:                 null,
    rr_planned:            2,
    r_multiple:            1,
    pnl_usd:               500,
    result:                'WIN',
    session:               'nyam',
    bias:                  null,
    setup:                 'SMT',
    confirmations:         null,
    emotional_state:       'CALM',
    followed_rules:        true,
    notes:                 '',
    tags:                  [],
    screenshots:           null,
    profile_processed_at:  null,
    profile_processed_rev: 0,
    ...overrides,
  };
}

function profile(): UserProfileRow {
  return {
    clerk_id:                'user_test',
    updated_at:              '2026-08-14T12:00:00Z',
    schema_version:          1,
    analyzer_version:        1,
    statistical:             { n: 127, wr: 0.58, avg_r: 0.42 },
    behavioral:              { strengths: ['SMT in London'] },
    narrative_summary:       'A patient trader with a London bias.',
    profile_token_count:     240,
    last_analyzed_at:        '2026-08-14T12:00:00Z',
    last_trade_included_id:  't0',
    last_note_included_id:   null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM_PROMPT / prompt version
// ═══════════════════════════════════════════════════════════════════════════

describe('SYSTEM_PROMPT', () => {
  it('declares the Hebrew-only rule', () => {
    expect(SYSTEM_PROMPT).toContain('Hebrew only');
  });

  it('forbids inventing numbers', () => {
    expect(SYSTEM_PROMPT).toContain("Never invent numbers");
  });

  it('explains the four data blocks the message will contain', () => {
    for (const tag of ['<user_profile>', '<today>', '<today_signals>', '<past_writing>']) {
      expect(SYSTEM_PROMPT).toContain(tag);
    }
  });

  it('caps the output at 500 tokens', () => {
    expect(SYSTEM_PROMPT).toContain('500 tokens');
  });
});

describe('GEMINI_STRICT_ADDENDUM', () => {
  it('tightens length to 350 tokens', () => {
    expect(GEMINI_STRICT_ADDENDUM).toContain('350 tokens');
  });

  it('instructs delete-on-ungrounded', () => {
    expect(GEMINI_STRICT_ADDENDUM).toContain('DELETE');
  });
});

describe('DAILY_INSIGHT_PROMPT_VERSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(DAILY_INSIGHT_PROMPT_VERSION)).toBe(true);
    expect(DAILY_INSIGHT_PROMPT_VERSION).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildUserMessage
// ═══════════════════════════════════════════════════════════════════════════

describe('buildUserMessage — structure', () => {
  const trades = [T()];
  const inputs = {
    profile: profile(),
    todayTrades: trades,
    signals: computeTodaySignals(trades),
    pastWritingBlock: '[]',
  };

  it('contains all four tagged blocks in order', () => {
    const msg = buildUserMessage(inputs);
    const iProfile  = msg.indexOf('<user_profile>');
    const iToday    = msg.indexOf('<today>');
    const iSignals  = msg.indexOf('<today_signals>');
    const iPast     = msg.indexOf('<past_writing>');
    expect(iProfile).toBeGreaterThanOrEqual(0);
    expect(iProfile).toBeLessThan(iToday);
    expect(iToday).toBeLessThan(iSignals);
    expect(iSignals).toBeLessThan(iPast);
  });

  it('closes every opened tag', () => {
    const msg = buildUserMessage(inputs);
    for (const t of ['user_profile', 'today', 'today_signals', 'past_writing']) {
      expect(msg).toContain(`<${t}>`);
      expect(msg).toContain(`</${t}>`);
    }
  });

  it('serializes today as a JSON array of compact trades', () => {
    const msg = buildUserMessage(inputs);
    const start = msg.indexOf('<today>') + '<today>\n'.length;
    const end   = msg.indexOf('</today>');
    const body  = msg.slice(start, end).trim();
    const arr   = JSON.parse(body);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr[0]).toHaveProperty('sym');
    expect(arr[0]).toHaveProperty('dir');
    expect(arr[0]).toHaveProperty('r');
    // Full-fat TradeRow fields must NOT be included in the compact form.
    expect(arr[0]).not.toHaveProperty('entry_price');
    expect(arr[0]).not.toHaveProperty('stop_loss');
  });

  it('handles missing profile with an empty defaults block', () => {
    const msg = buildUserMessage({ ...inputs, profile: null });
    const start = msg.indexOf('<user_profile>') + '<user_profile>\n'.length;
    const end   = msg.indexOf('</user_profile>');
    const body  = JSON.parse(msg.slice(start, end).trim());
    expect(body).toEqual({ statistical: {}, behavioral: {}, narrative_summary: '' });
  });

  it('embeds the past_writing block verbatim', () => {
    const past = '[{"date":"2026-07-15","snippet":"hi","kind":"note","score":0.9}]';
    const msg = buildUserMessage({ ...inputs, pastWritingBlock: past });
    expect(msg).toContain(past);
  });

  it('serializes today as [] when no trades', () => {
    const msg = buildUserMessage({ ...inputs, todayTrades: [], signals: computeTodaySignals([]) });
    expect(msg).toContain('<today>\n[]\n</today>');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Internals: sha256Hex
// ═══════════════════════════════════════════════════════════════════════════

describe('sha256Hex', () => {
  const { sha256Hex } = __internals;

  it('is stable — same input → same 64-char hex', () => {
    const h1 = sha256Hex('hello');
    const h2 = sha256Hex('hello');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(h1)).toBe(true);
  });

  it('changes with input', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });

  it('handles empty string', () => {
    expect(sha256Hex('')).toHaveLength(64);
  });
});
