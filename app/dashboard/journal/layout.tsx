import { requirePlan } from '../../lib/withRoleCheck';

// PRO+ only. Runs server-side on every navigation into this segment; a lower
// plan is redirected to /checkout before the page renders.
export default async function JournalGuard({ children }: { children: React.ReactNode }) {
  await requirePlan('pro');
  return <>{children}</>;
}
