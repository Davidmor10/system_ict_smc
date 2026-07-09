import { requirePlan } from '../../lib/withRoleCheck';

// PRO+ only (rules).
export default async function RulesGuard({ children }: { children: React.ReactNode }) {
  await requirePlan('pro');
  return <>{children}</>;
}
