import { getUserContext, ROLE_RANK } from '../../lib/getUserRole';
import LockedFeature from '../../components/LockedFeature';

// PRO+ feature. `free` and `starter` see the real page blurred behind an
// upgrade CTA (they see what they're missing); `pro` and `deluxe` get full
// access. No hard redirect anymore — the locked overlay is the primary
// upgrade funnel now.
export default async function AiAnalyticsGuard({ children }: { children: React.ReactNode }) {
  const { role } = await getUserContext();
  if (ROLE_RANK[role] >= ROLE_RANK.pro) return <>{children}</>;

  return (
    <LockedFeature
      title="אנליטיקת ה-AI נעולה"
      description="שדרג ל-Pro כדי לפתוח ניתוח AI מלא של היומן שלך — דפוסים חוזרים, סימולטור תרחישים ודוח שבועי, עם ההסבר המספרי מאחורי כל מסקנה."
      ctaLabel="שדרוג ל-Pro ←"
    >
      {children}
    </LockedFeature>
  );
}
