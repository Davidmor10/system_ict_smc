import { notFound } from 'next/navigation';
import AdminPanel from '../../components/checkout/AdminPanel';
import { viewerIsAdmin } from '../../lib/payments/admin';
import { listAllRequests } from '../../lib/payments/requests';
import '../../checkout/checkout.css';

// ─────────────────────────────────────────────────────────────────────────────
// /dashboard/payments — the owner's verification queue.
//
// It used to hang off /checkout behind a toggle, which meant leaving the app to
// reach it and passing through the plan grid on the way. It belongs here: the
// owner is signed in and already looking at the dashboard when the notification
// arrives.
//
// TWO GATES, AND NEITHER IS THE SIDEBAR LINK. The link is hidden for everyone
// else, but hiding is not access control:
//
//   • notFound() for a non-admin — the same answer as a page that does not
//     exist, so the URL does not confirm that a verification screen is there;
//   • the rows are only read after that check passes, so a non-admin's HTML
//     never contains another customer's name or address in the first place.
//
// The API behind the panel checks again on every call. Three independent
// checks for one screen is deliberate: this is the screen that opens paid
// accounts.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

export default async function PaymentsPage() {
  if (!(await viewerIsAdmin())) notFound();

  return (
    <div className="ck ck-embedded" dir="rtl">
      <AdminPanel initialRequests={await listAllRequests()} />
    </div>
  );
}
