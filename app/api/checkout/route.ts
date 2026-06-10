import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getStripe, isStripeConfigured, priceIdForTier } from '../../lib/stripe/server';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../lib/supabase/server';

// Creates a Stripe hosted Checkout session for the signed-in user and returns
// its URL. When Stripe isn't configured we return { configured: false } so the
// checkout page can fall back to its demo confirmation rather than erroring.
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { tier } = await req.json().catch(() => ({ tier: 'deluxe' }));
  const price = priceIdForTier(tier);
  if (!price) {
    return NextResponse.json({ error: `No price configured for tier "${tier}"` }, { status: 400 });
  }

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;

  // Reuse a stored Stripe customer if we have one (avoids duplicate customers).
  let customerId: string | undefined;
  if (isSupabaseConfigured()) {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('clerk_id', userId)
      .maybeSingle();
    customerId = data?.stripe_customer_id ?? undefined;
  }

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? '';

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: `${origin}/dashboard?upgraded=1`,
      cancel_url: `${origin}/checkout?canceled=1`,
      client_reference_id: userId,
      customer: customerId,
      customer_email: customerId ? undefined : email,
      allow_promotion_codes: true,
      metadata: { clerk_id: userId, tier },
      // Propagate clerk_id onto the subscription so later lifecycle webhooks
      // (renewal, cancel) can map back to the right profile.
      subscription_data: { metadata: { clerk_id: userId, tier } },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[checkout] failed to create session', err);
    return NextResponse.json({ error: 'Checkout failed' }, { status: 500 });
  }
}
