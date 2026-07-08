// ─────────────────────────────────────────────────────────────────────────────
// AI Memory — durable "known facts" about how a trader trades (e.g. "performs
// better in London", "strongest with MNQ", "exits early under pressure").
// These are template-generated in plain Hebrew, NOT phrased by an LLM: they're
// simple, formulaic statements over fields the profile already computed, so
// there's no hallucination risk and no extra AI cost for something this
// factual. The narrative/hypothesis prompts cite these as persistent context
// instead of re-deriving the same observation from scratch every time.
// ─────────────────────────────────────────────────────────────────────────────

import { SESS } from '../sessions';
import type { KnownFact, TraderProfile } from './types';

const MIN_CONFIRMATION_WIN_RATE = 55;
const EXIT_EARLY_RATIO_THRESHOLD = 0.7;
const MIN_EXIT_WINNERS = 3;

function sessionLabel(key: string): string {
  return SESS.find(s => s.key === key)?.he ?? key;
}

interface FactCandidate {
  fact: string;
  sourceField: string;
  confidence: KnownFact['confidence'];
}

/** Pure: turns stable TraderProfile fields into durable Hebrew fact
    statements, preserving `firstStatedAt` when the same specific claim
    persists (matched by sourceField + identical text) and only resetting it
    when the underlying subject actually changes (e.g. strongest instrument
    flips from MNQ to NQ — that's a new claim, not a continuation). */
export function deriveKnownFacts(profile: TraderProfile, previousFacts: KnownFact[], nowISO: string): KnownFact[] {
  const candidates: FactCandidate[] = [];

  if (profile.strongestSession) {
    candidates.push({
      fact: `אתה מבצע הכי טוב במושב ${sessionLabel(profile.strongestSession.key)}.`,
      sourceField: 'strongestSession',
      confidence: profile.strongestSession.confidence.level,
    });
  }
  if (profile.weakestSession) {
    candidates.push({
      fact: `המושב הכי חלש שלך הוא ${sessionLabel(profile.weakestSession.key)}.`,
      sourceField: 'weakestSession',
      confidence: profile.weakestSession.confidence.level,
    });
  }
  if (profile.strongestInstrument) {
    candidates.push({
      fact: `החוזק שלך הוא ${profile.strongestInstrument.key}.`,
      sourceField: 'strongestInstrument',
      confidence: profile.strongestInstrument.confidence.level,
    });
  }
  if (profile.weakestInstrument) {
    candidates.push({
      fact: `אתה מתקשה יותר עם ${profile.weakestInstrument.key}.`,
      sourceField: 'weakestInstrument',
      confidence: profile.weakestInstrument.confidence.level,
    });
  }
  if (profile.direction.edge !== 'none') {
    const dirHe = profile.direction.edge === 'long' ? 'לונג' : 'שורט';
    candidates.push({ fact: `אתה חזק יותר בעסקאות ${dirHe}.`, sourceField: 'direction.edge', confidence: 'medium' });
  }
  // Prefer the real capture ratio (from recorded exit legs) once there's a
  // meaningful sample; fall back to the legacy proxy ratio otherwise.
  const exitDetail = profile.exitBehavior.detail;
  if (exitDetail.captureRatio !== null && exitDetail.winnerCount >= MIN_EXIT_WINNERS) {
    if (exitDetail.captureRatio < EXIT_EARLY_RATIO_THRESHOLD) {
      candidates.push({
        fact: `אתה נוטה לחתוך מנצחים מוקדם — בממוצע אתה ממש רק ${Math.round(exitDetail.captureRatio * 100)}% מהיעד המתוכנן שלך בעסקאות מנצחות.`,
        sourceField: 'exitBehavior',
        confidence: exitDetail.winnerCount >= 10 ? 'high' : 'medium',
      });
    }
  } else if (profile.exitBehavior.ratio !== null && profile.exitBehavior.ratio < EXIT_EARLY_RATIO_THRESHOLD) {
    candidates.push({
      fact: 'אתה נוטה לצאת מוקדם מעסקאות מרוויחות, מתחת לתוכנית המקורית שלך.',
      sourceField: 'exitBehavior',
      confidence: 'medium',
    });
  }
  const topConfirmation = profile.topConfirmations[0];
  if (topConfirmation && topConfirmation.winRate >= MIN_CONFIRMATION_WIN_RATE && topConfirmation.confidence.sampleSize >= 3) {
    candidates.push({
      fact: `האישור "${topConfirmation.key}" מופיע ברוב העסקאות הרווחיות שלך.`,
      sourceField: 'topConfirmations[0]',
      confidence: topConfirmation.confidence.level,
    });
  }

  return candidates.map((c): KnownFact => {
    const prev = previousFacts.find(f => f.sourceField === c.sourceField);
    const sameClaimAsBefore = prev?.fact === c.fact;
    return {
      ...c,
      firstStatedAt: sameClaimAsBefore ? prev!.firstStatedAt : nowISO,
      lastConfirmedAt: nowISO,
    };
  });
}
