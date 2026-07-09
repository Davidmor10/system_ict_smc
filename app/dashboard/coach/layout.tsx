import { requirePlan } from '../../lib/withRoleCheck';

// DELUXE only (AI coach).
export default async function CoachGuard({ children }: { children: React.ReactNode }) {
  await requirePlan('deluxe');
  return <>{children}</>;
}
