import { getUserRole } from '../../lib/getUserRole';
import { requirePlan } from '../../lib/withRoleCheck';
import LockedFeature from '../../components/LockedFeature';

// DELUXE only (AI coach). FREE users see the real page rendered locked,
// with an upgrade prompt, instead of being redirected away from it.
export default async function CoachGuard({ children }: { children: React.ReactNode }) {
  const role = await getUserRole();
  if (role === 'free') {
    return (
      <LockedFeature
        title="מאמן AI — פיצ'ר Deluxe"
        description="צ'אט חכם שמנתח את היומן האישי שלך ועונה על שאלות מסחר — נעול עד לשדרוג ל-Deluxe."
      >
        {children}
      </LockedFeature>
    );
  }
  await requirePlan('deluxe');
  return <>{children}</>;
}
