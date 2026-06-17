'use client';

import dynamic from 'next/dynamic';

const StatsView = dynamic(() => import('./StatsView'), { ssr: false });

export default function StatsWorkspace() {
  return <StatsView />;
}
