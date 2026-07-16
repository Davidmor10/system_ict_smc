import { requirePlan } from '../../lib/withRoleCheck';

// FREE+ (open to every signed-in user; rules).
export default async function RulesGuard({ children }: { children: React.ReactNode }) {
  await requirePlan('free');
  return <>{children}</>;
}
