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

// Both paid tiers grant the binary 'pro' role; the tier only picks the price.
const PRICE_BY_TIER: Record<string, string | undefined> = {
  premium: process.env.STRIPE_PRICE_PREMIUM,
  deluxe: process.env.STRIPE_PRICE_DELUXE,
};

export function priceIdForTier(tier: string): string | undefined {
  return PRICE_BY_TIER[tier];
}
