import { auth, currentUser } from '@clerk/nextjs/server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import CheckoutFlow from '../components/checkout/CheckoutFlow';
import { isAdminEmail } from '../lib/payments/admin';
import { latestRequestFor, listAllRequests } from '../lib/payments/requests';
import { DEFAULT_PLAN, isPlanKey, type PaymentRequest, type PlanKey } from '../lib/payments/plans';
import './checkout.css';

// ─────────────────────────────────────────────────────────────────────────────
// /checkout — plan selection, Bit payment, and the owner's verification panel.
//
// A SERVER component on purpose. Two of the three things it decides must not be
// decided in the browser:
//
//   • whether this viewer is an admin — from the session and the server's own
//     allowlist, never from anything the page was handed;
//   • what request data exists at all — a non-admin's page payload contains no
//     rows, so other customers' names and addresses are not merely hidden from
//     the UI, they are never serialised into the HTML.
//
// The prototype gated the panel client-side. That is a UI convenience; this is
// the gate.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

/** Bit details, supplied by the owner through the environment rather than
 *  committed. Rendered as — until they are set, exactly as the design shows. */
function bitDetails(): { number: string | null; payee: string | null } {
  const number = process.env.NEXT_PUBLIC_BIT_NUMBER?.trim();
  const payee = process.env.NEXT_PUBLIC_BIT_PAYEE?.trim();
  return { number: number || null, payee: payee || null };
}

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
  const canSeeAdmin = isAdminEmail(email);

  // Only an admin's payload ever contains rows.
  const initialRequests: PaymentRequest[] = canSeeAdmin ? await listAllRequests() : [];
  const myRequest = userId ? await latestRequestFor(userId) : null;

  const { plan } = await searchParams;
  const initialPlan: PlanKey = isPlanKey(plan) ? plan : DEFAULT_PLAN;

  const bit = bitDetails();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();

  return (
    <CheckoutFlow
      canSeeAdmin={canSeeAdmin}
      initialRequests={initialRequests}
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
