// ─────────────────────────────────────────────────────────────────────────────
// What this account actually is, on the server and in this browser.
//
// One trader's journal appeared in another's account, and three fixes shipped
// against a description of the symptom rather than a measurement of it. This
// page is the measurement. It answers, side by side and without interpretation:
//
//   • which account the SERVER authenticated this request as
//   • how many rows the CLOUD holds for that account
//   • which account this BROWSER's cache says it belongs to
//
// Those three disagreeing is the whole diagnosis, and which pair disagrees
// says which layer is at fault:
//
//   server ≠ the account that was signed into  → a session problem, not data
//   cloud still holds rows after a cleanup     → the delete did not run
//   cloud empty but the screen is full         → the browser restored a cache
//
// Read-only. Nothing here writes, deletes, or repairs anything.
// ─────────────────────────────────────────────────────────────────────────────

import { auth, currentUser } from '@clerk/nextjs/server';
import { getUserContext } from '../../lib/getUserRole';
import { createServerSupabaseClient, isSupabaseConfigured } from '../../lib/supabase/server';
import LocalCacheReport from '../../components/LocalCacheReport';

export const dynamic = 'force-dynamic';

/** Rows this account owns, per table. `null` means the table could not be
 *  counted — reported as such rather than as a zero, because a zero here is
 *  the answer to "did the cleanup work" and must never be guessed. */
async function cloudCounts(clerkId: string): Promise<Record<string, number | null>> {
  const tables = ['journal_trades', 'intelligence_trades', 'user_collections', 'notebook_entries'];
  if (!isSupabaseConfigured()) return Object.fromEntries(tables.map(t => [t, null]));
  const supabase = createServerSupabaseClient();
  const out: Record<string, number | null> = {};
  await Promise.all(tables.map(async table => {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('clerk_id', clerkId);
    out[table] = error ? null : (count ?? 0);
  }));
  return out;
}

export default async function DiagnosticsPage() {
  const { userId } = await auth();
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const counts = userId ? await cloudCounts(userId) : {};
  const { isOwner } = await getUserContext();

  // Deleting an account is reachable from Clerk's own profile dialog, and the
  // purge that follows runs only if Clerk can reach the webhook. When the
  // signing secret is absent the account disappears and everything the trader
  // wrote stays in the database forever — silently, because nothing fails.
  // The code cannot configure the endpoint; it can refuse to hide that it
  // isn't. Owner-only: it is an operational fact, not a trader's business.
  const deletionWired = !!process.env.CLERK_WEBHOOK_SIGNING_SECRET;

  return (
    <div dir="rtl" className="h-full overflow-y-auto px-6 py-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-[#d4af37] mb-1">אבחון חשבון</h1>
      <p className="text-sm text-[#8a8a8a] mb-8">
        קריאה בלבד. הדף לא משנה, לא מוחק ולא מתקן דבר.
      </p>

      <section className="mb-8">
        <h2 className="text-base font-medium text-[#e3c768] mb-3">מי אתה, לפי השרת</h2>
        <dl className="rounded-lg border border-[#2a2a2d] bg-[#0d0d0f] divide-y divide-[#1c1c1e]">
          <Row label="כתובת דוא״ל" value={email ?? '—'} />
          <Row label="מזהה חשבון" value={userId ?? '—'} mono />
        </dl>
        <p className="text-xs text-[#6a6a6a] mt-2">
          זו הזהות שכל שאילתה לבסיס הנתונים משתמשת בה. אם היא לא החשבון שנכנסת אליו, הבעיה בהתחברות ולא בנתונים.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-medium text-[#e3c768] mb-3">מה יש בענן לחשבון הזה</h2>
        <dl className="rounded-lg border border-[#2a2a2d] bg-[#0d0d0f] divide-y divide-[#1c1c1e]">
          {Object.entries(counts).map(([table, n]) => (
            <Row key={table} label={table} value={n === null ? 'לא ניתן לספור' : String(n)} mono />
          ))}
        </dl>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-medium text-[#e3c768] mb-3">מה יש בדפדפן הזה</h2>
        <LocalCacheReport serverUserId={userId ?? null} />
      </section>

      {isOwner && (
        <section>
          <h2 className="text-base font-medium text-[#e3c768] mb-3">תפעול</h2>
          <dl className="rounded-lg border border-[#2a2a2d] bg-[#0d0d0f] divide-y divide-[#1c1c1e]">
            <Row label="מחיקת חשבון מחוברת" value={deletionWired ? 'כן' : 'לא'} />
          </dl>
          <p className={`text-xs mt-2 ${deletionWired ? 'text-[#7fae8c]' : 'text-[#c07878]'}`}>
            {deletionWired
              ? 'סוד החתימה מוגדר. מחיקת חשבון ב־Clerk תפעיל את הניקוי המלא.'
              : 'סוד החתימה חסר. מחיקת חשבון ב־Clerk תמחק את ההתחברות ותשאיר את כל הנתונים בבסיס הנתונים, בלי שגיאה בשום מקום.'}
          </p>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-[#8a8a8a]">{label}</dt>
      <dd className={`text-sm text-[#d8d8d8] ${mono ? 'font-mono text-xs' : ''} break-all text-left`} dir="ltr">
        {value}
      </dd>
    </div>
  );
}
