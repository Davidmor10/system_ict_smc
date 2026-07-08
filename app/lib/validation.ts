// ─────────────────────────────────────────────────────────────────────────────
// Runtime request-body validation for API routes that write to Supabase.
//
// TypeScript types on `await req.json()` are a compile-time-only annotation —
// they don't stop a malformed or hostile body from reaching the database.
// Every schema here is deliberately bounded (max lengths/counts) so a bad
// request fails fast with a 400 instead of writing oversized or malformed
// rows.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { INSTRUMENT_KEYS } from './instruments';

const MAX_TEXT = 2000;
const MAX_SCREENSHOTS = 10;
const MAX_SCREENSHOT_LEN = 2_000_000; // generous bound for a base64 data-URL image

export const tradeEntrySchema = z.object({
  id: z.number(),
  dateISO: z.string().max(20),
  time: z.string().max(20),
  symbol: z.enum(INSTRUMENT_KEYS),
  contracts: z.number().int().min(1).max(1000),
  direction: z.enum(['LONG', 'SHORT']),
  entry: z.number().finite(),
  stop: z.number().finite(),
  target: z.number().finite(),
  session: z.string().max(50),
  bias: z.enum(['BULLISH', 'BEARISH', 'INDECISIVE']),
  model: z.string().max(200),
  result: z.enum(['OPEN', 'WIN', 'LOSS', 'BE']),
  notes: z.string().max(MAX_TEXT),
  accountId: z.string().max(200).optional(),
  setup: z.enum(['REVERSAL', 'CONTINUATION']).optional(),
  confirmation: z.enum(['IFVG_1M', 'IFVG_2M', 'IFVG_3M', 'IFVG_5M']).optional(),
  biasAlignment: z.enum(['ALIGNED', 'COUNTER']).optional(),
  tradeR: z.number().finite().optional(),
  pnlUsd: z.number().finite().optional(),
  screenshots: z.array(z.string().max(MAX_SCREENSHOT_LEN)).max(MAX_SCREENSHOTS).optional(),
  exits: z.array(z.object({
    price: z.number().finite(),
    contracts: z.number().finite().min(0),
  })).max(50).optional(),
  confirmations: z.array(z.string().max(60)).max(40).optional(),
  emotionalState: z.enum(['CALM', 'CONFIDENT', 'STRESSED', 'FOMO', 'TIRED', 'ANGRY', 'IMPATIENT']).optional(),
});

export const tradesArraySchema = z.array(tradeEntrySchema).max(5000);

export const userPrefsPatchSchema = z.object({
  chart_tf_es: z.string().max(20).optional(),
  chart_tf_nq: z.string().max(20).optional(),
  analysis_state: z.record(z.string(), z.unknown()).nullable().optional(),
  lockout_config: z.record(z.string(), z.unknown()).nullable().optional(),
  news_filters: z.record(z.string(), z.unknown()).nullable().optional(),
});
