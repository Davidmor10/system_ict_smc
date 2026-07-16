import { requirePlan } from '../../lib/withRoleCheck';

// FREE+ (open to every signed-in user). The AI insight panel inside the page
// itself still gates on 'pro' — this layout no longer restricts the journal.
export default async function JournalGuard({ children }: { children: React.ReactNode }) {
  await requirePlan('free');
  return <>{children}</>;
}
