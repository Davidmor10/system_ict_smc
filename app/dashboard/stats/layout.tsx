import { requirePlan } from '../../lib/withRoleCheck';

// DELUXE only (statistics).
export default async function StatsGuard({ children }: { children: React.ReactNode }) {
  await requirePlan('deluxe');
  return <>{children}</>;
}
