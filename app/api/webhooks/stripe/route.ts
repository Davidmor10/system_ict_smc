import type Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { getStripe, isStripeConfigured } from '../../../lib/stripe/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase/server';

// Stripe → Supabase subscription sync. Drives the tiered role from the plan the
// user actually purchased (tier is stamped in Stripe metadata by /api/checkout):
//   • checkout.session.completed   → upgrade to the purchased tier's role
//   • customer.subscription.updated → that role while active/trialing, else 'free'
//   • customer.subscription.deleted → auto-downgrade to 'free'
// Signature-verified against the raw body; never trusts an unsigned payload.

// Stripe statuses that still entitle paid access.
const PAID_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing']);

// The 'deluxe' tier unlocks everything; any other paid tier ('premium'/'pro')
// grants 'pro'. Defaults to 'pro' so a paying customer is never left at 'free'.
function roleForTier(tier: string | null | undefined): 'pro' | 'deluxe' {
  return tier === 'deluxe' ? 'deluxe' : 'pro';
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SIGNING_SECRET;
  if (!isStripeConfigured() || !secret) {
    console.error('[stripe-webhook] Stripe or webhook secret not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 });
  }

  // Raw body required — re-serializing would invalidate the signature.
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    console.warn('[stripe-webhook] Supabase not configured — event acknowledged but not persisted');
    return NextResponse.json({ ok: true, persisted: false });
  }

  const supabase = createServerSupabaseClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const clerkId = s.metadata?.clerk_id ?? s.client_reference_id;
        if (!clerkId) break;
        const { error } = await supabase
          .from('profiles')
          .update({
            role: roleForTier(s.metadata?.tier),
            stripe_customer_id: typeof s.customer === 'string' ? s.customer : null,
            stripe_subscription_id: typeof s.subscription === 'string' ? s.subscription : null,
            subscription_status: 'active',
          })
          .eq('clerk_id', clerkId);
        if (error) throw error;
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const paid = event.type !== 'customer.subscription.deleted' && PAID_STATUSES.has(sub.status);
        const clerkId = sub.metadata?.clerk_id;
        const customerId = typeof sub.customer === 'string' ? sub.customer : null;

        // Prefer the clerk_id we stamped on the subscription; fall back to the
        // stored customer id so we still resolve the profile either way.
        const query = supabase
          .from('profiles')
          .update({
            role: paid ? roleForTier(sub.metadata?.tier) : 'free',
            subscription_status: event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status,
          });

        const { error } = clerkId
          ? await query.eq('clerk_id', clerkId)
          : customerId
            ? await query.eq('stripe_customer_id', customerId)
            : { error: null };
        if (error) throw error;
        break;
      }

      default:
        // Other event types are acknowledged without action.
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook] persistence error', err);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, persisted: true });
}
