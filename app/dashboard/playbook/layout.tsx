import { requirePlan } from '../../lib/withRoleCheck';

// FREE+ (open to every signed-in user; setups / playbook).
export default async function PlaybookGuard({ children }: { children: React.ReactNode }) {
  await requirePlan('free');
  return <>{children}</>;
}
