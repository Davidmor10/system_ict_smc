import Anthropic from '@anthropic-ai/sdk';

/** Single shared client — every AI route in the app goes through this. */
export const anthropic = new Anthropic();

/** Fast, cheap model — every insight here is a phrasing task over numbers
    that are already computed, not open-ended reasoning, so Haiku is enough. */
export const AI_MODEL = 'claude-haiku-4-5-20251001';
