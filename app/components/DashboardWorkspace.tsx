'use client';

import dynamic from 'next/dynamic';

const DashboardView = dynamic(() => import('./DashboardView'), { ssr: false });

export default function DashboardWorkspace({
  role,
  macroBoard,
}: {
  role: 'free' | 'pro';
  macroBoard?: React.ReactNode;
}) {
  return <DashboardView role={role} macroBoard={macroBoard} />;
}
