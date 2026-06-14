'use client';

import dynamic from 'next/dynamic';

// Client wrapper so the workspace keeps ssr:false (clock/localStorage are
// client-only) while the dashboard page itself stays a Server Component.
// `sidebar` is a Server Component (NewsWidget) passed through untouched — a
// client component may render server components it receives as props.
const DashboardView = dynamic(() => import('./DashboardView'), { ssr: false });

export default function DashboardWorkspace({ sidebar }: { sidebar?: React.ReactNode }) {
  return <DashboardView sidebar={sidebar} />;
}
