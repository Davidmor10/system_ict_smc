import { redirect } from 'next/navigation';
import { getUserContext } from '../../lib/getUserRole';
import LockedFeature from '../../components/LockedFeature';

// DELUXE feature. `free` sees the real page blurred behind an upgrade CTA
// instead of being redirected away — `pro` keeps the original hard redirect
// to the upgrade funnel (unchanged), `deluxe` gets full access.
export default async function AiAnalyticsGuard({ children }: { children: React.ReactNode }) {
  const { role } = await getUserContext();
  if (role === 'deluxe') return <>{children}</>;

  if (role === 'free') {
    return (
      <LockedFeature
        title="אנליטיקת ה-AI נעולה"
        description="שדרג ל-Deluxe כדי לפתוח ניתוח AI מלא של היומן שלך — דפוסים חוזרים, סימולטור תרחישים ודוח שבועי, עם ההסבר המספרי מאחורי כל מסקנה."
      >
        {children}
      </LockedFeature>
    );
  }

  redirect('/checkout'); // role === 'pro'
}
