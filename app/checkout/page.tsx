import { auth, currentUser } from '@clerk/nextjs/server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import CheckoutFlow from '../components/checkout/CheckoutFlow';
import { latestRequestFor } from '../lib/payments/requests';
import { getBitSettings } from '../lib/payments/settings';
import { DEFAULT_PLAN, isPlanKey, type PlanKey } from '../lib/payments/plans';
import './checkout.css';

// ─────────────────────────────────────────────────────────────────────────────
// /checkout — plan selection and Bit payment.
//
// A SERVER component on purpose: the only request row it reads is the viewer's
// own, looked up by the session's clerk_id rather than by anything the page was
// handed. The owner's verification panel used to be a third screen here behind
// a toggle; it now lives at /dashboard/payments, so no page in the customer
// flow reads another customer's row at all.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';



/** Whether the three per-plan QR images have been added to /public/bit.
 *
 *  Checked rather than assumed: an <img> pointing at a file nobody has
 *  supplied yet renders as a broken icon inside a gold-glowing frame, which
 *  looks like a bug in the payment page. Absent, the frame says which code is
 *  missing instead. */
function qrAvailable(): boolean {
  try {
    const dir = join(process.cwd(), 'public', 'bit');
    return ['starter', 'pro', 'deluxe'].every(k => existsSync(join(dir, `bit-qr-${k}.png`)));
  } catch {
    return false;
  }
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  // Guarded the way the root layout guards it. `auth()` throws outright when
  // the Clerk middleware is not running — a missing key, a misconfigured
  // deploy — and the plan grid is the last page that should answer a visitor
  // with a 500. Signed out, they see the plans and pay after signing in.
  let userId: string | null = null;
  let user: Awaited<ReturnType<typeof currentUser>> = null;
  try {
    userId = (await auth()).userId;
    user = await currentUser();
  } catch {
    userId = null;
  }

  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const myRequest = userId ? await latestRequestFor(userId) : null;

  const { plan } = await searchParams;
  const initialPlan: PlanKey = isPlanKey(plan) ? plan : DEFAULT_PLAN;

  // Read from the owner's settings, falling back to the environment.
  const bit = await getBitSettings();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();

  return (
    <CheckoutFlow
      myRequest={myRequest}
      defaultName={name}
      defaultEmail={email}
      initialPlan={initialPlan}
      bitNumber={bit.number}
      bitPayee={bit.payee}
      qrAvailable={qrAvailable()}
    />
  );
}
