import { requirePlan } from '../../lib/withRoleCheck';

// DELUXE only (AI analytics).
export default async function AiAnalyticsGuard({ children }: { children: React.ReactNode }) {
  await requirePlan('deluxe');
  return <>{children}</>;
}
