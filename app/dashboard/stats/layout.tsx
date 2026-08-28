import { requirePlan } from '../../lib/withRoleCheck';

// Statistics is part of the journal, not part of the AI.
//
// It was Deluxe-only, and nothing on the pricing page said so — the sidebar
// showed the entry, and clicking it threw the trader out of the app to the
// checkout page with no explanation, including a Pro subscriber who had paid
// for "the full intelligence layer". Every number on the page is arithmetic
// over trades the trader typed in themselves; there is no model call behind
// any of it, and no reason it should sit behind one.
export default async function StatsGuard({ children }: { children: React.ReactNode }) {
  await requirePlan('starter');
  return <>{children}</>;
}
