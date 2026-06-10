'use client';

import dynamic from 'next/dynamic';

// Client wrapper so AnalyticsView keeps ssr:false (clocks/localStorage are
// client-only) while the page itself stays a Server Component that can gate access.
const AnalyticsView = dynamic(() => import('./AnalyticsView'), { ssr: false });

export default function AnalyticsWorkspace() {
  return <AnalyticsView />;
}
