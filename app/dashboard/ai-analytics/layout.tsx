import { getUserRole } from '../../lib/getUserRole';
import { requirePlan } from '../../lib/withRoleCheck';
import LockedFeature from '../../components/LockedFeature';

// DELUXE only (AI analytics). FREE users see the real page rendered locked,
// with an upgrade prompt, instead of being redirected away from it.
export default async function AiAnalyticsGuard({ children }: { children: React.ReactNode }) {
  const role = await getUserRole();
  if (role === 'free') {
    return (
      <LockedFeature
        title="ניתוח AI מתקדם — פיצ'ר Deluxe"
        description="פילוח מלא לפי אינסטרומנט, סשן, זמן, סטאפ, קונפלואנס, מצב רגשי וניהול יציאות, וזיהוי דפוסים חכם — נעול עד לשדרוג ל-Deluxe."
      >
        {children}
      </LockedFeature>
    );
  }
  await requirePlan('deluxe');
  return <>{children}</>;
}
