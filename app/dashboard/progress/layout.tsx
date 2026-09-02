import { getUserContext, ROLE_RANK } from '../../lib/getUserRole';
import LockedFeature from '../../components/LockedFeature';

// PRO+ feature, matching the layer it draws from.
//
// The behaviour lifecycle, the learning score and the evolution timeline are
// all produced by the nightly pipeline, which only runs for Pro and above —
// so a Starter account opening this page would find a screen that is empty for
// a reason the screen cannot explain. Blurred behind the upgrade CTA instead,
// like the analytics page, so they can see what it is before deciding.
export default async function ProgressGuard({ children }: { children: React.ReactNode }) {
  const { role } = await getUserContext();
  if (ROLE_RANK[role] >= ROLE_RANK.pro) return <>{children}</>;

  return (
    <LockedFeature
      title="המסלול נעול"
      description="שדרג ל-Pro כדי לראות מה השתנה אצלך — התנהגות שנמדדת בחלון סגור, מה כבר השתנה והחזיק, וציון הלמידה לאורך זמן."
      ctaLabel="שדרוג ל-Pro ←"
    >
      {children}
    </LockedFeature>
  );
}
