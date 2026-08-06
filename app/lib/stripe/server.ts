import Stripe from 'stripe';

// Server-side Stripe client. Guarded like Supabase so the app runs fine until
// the user supplies keys. Never import this into client components.

const key = process.env.STRIPE_SECRET_KEY;

export function isStripeConfigured(): boolean {
  return !!key;
}

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY missing — set it in .env.local');
  }
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}

// Three paid tiers, three distinct Stripe price IDs. Each tier maps to its
// own role in the webhook (starter/pro/deluxe). Prices are wired per env
// var — see .env.example for the mapping.
const PRICE_BY_TIER: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,   // ₪49/mo — unlocks AI Insight
  pro:     process.env.STRIPE_PRICE_PRO,       // ₪99/mo — adds AI Analytics
  deluxe:  process.env.STRIPE_PRICE_DELUXE,    // ₪199/mo — adds the AI Coach
};

export function priceIdForTier(tier: string): string | undefined {
  return PRICE_BY_TIER[tier];
}
