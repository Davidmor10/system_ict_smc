import { redirect } from 'next/navigation';
import { getUserContext } from '../../lib/getUserRole';
import LockedFeature from '../../components/LockedFeature';

// DELUXE feature. `free` sees the real page blurred behind an upgrade CTA
// instead of being redirected away — `pro` keeps the original hard redirect
// to the upgrade funnel (unchanged), `deluxe` gets full access.
export default async function CoachGuard({ children }: { children: React.ReactNode }) {
  const { role } = await getUserContext();
  if (role === 'deluxe') return <>{children}</>;

  if (role === 'free') {
    return (
      <LockedFeature
        title="המאמן האישי נעול"
        description="שדרג ל-Deluxe כדי לשוחח עם המאמן — הוא קורא את היומן שלך ועונה על שאלות מסחר בהתבסס אך ורק על הנתונים והמושגים האמיתיים שלך."
      >
        {children}
      </LockedFeature>
    );
  }

  redirect('/checkout'); // role === 'pro'
}
