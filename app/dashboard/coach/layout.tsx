import { getUserContext } from '../../lib/getUserRole';
import LockedFeature from '../../components/LockedFeature';

// DELUXE-only. Everyone below (free/starter/pro) sees the real page blurred
// behind an upgrade CTA so they see what the coach is before deciding.
export default async function CoachGuard({ children }: { children: React.ReactNode }) {
  const { role } = await getUserContext();
  if (role === 'deluxe') return <>{children}</>;

  return (
    <LockedFeature
      title="המאמן האישי נעול"
      description="שדרג ל-Deluxe כדי לשוחח עם המאמן — הוא קורא את היומן שלך ועונה על שאלות מסחר בהתבסס אך ורק על הנתונים והמושגים האמיתיים שלך."
      ctaLabel="שדרוג ל-Deluxe ←"
    >
      {children}
    </LockedFeature>
  );
}
