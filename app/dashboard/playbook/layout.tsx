import { requirePlan } from '../../lib/withRoleCheck';

// PRO+ only (setups / playbook).
export default async function PlaybookGuard({ children }: { children: React.ReactNode }) {
  await requirePlan('pro');
  return <>{children}</>;
}
