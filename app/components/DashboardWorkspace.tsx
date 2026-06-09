'use client';

import dynamic from 'next/dynamic';

// Client wrapper so the workspace keeps ssr:false (clock/localStorage are
// client-only) while the dashboard page itself stays a Server Component.
const DashboardView = dynamic(() => import('./DashboardView'), { ssr: false });

export default function DashboardWorkspace() {
  return <DashboardView />;
}
