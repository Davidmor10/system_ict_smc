'use client';

import { usePlan } from '../components/PlanProvider';
import DashboardView from '../components/DashboardView';
import FreeDashboardView from '../components/FreeDashboardView';

// `free` gets its own dedicated dashboard (self-contained, Hebrew-only trading
// terminal view). `pro`/`deluxe` keep the existing Trading Command Center —
// that view is getting its own AI-centric redesign separately; this file just
// routes between the two by plan, it doesn't touch DashboardView itself.
export default function DashboardPage() {
  const { role } = usePlan();
  return role === 'free' ? <FreeDashboardView /> : <DashboardView />;
}
