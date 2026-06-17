'use client';

import dynamic from 'next/dynamic';

const DashboardView = dynamic(() => import('./DashboardView'), { ssr: false });

export default function DashboardWorkspace({
  role,
  isOwner,
  macroBoard,
}: {
  role: 'free' | 'pro';
  isOwner?: boolean;
  macroBoard?: React.ReactNode;
}) {
  return <DashboardView role={role} isOwner={isOwner} macroBoard={macroBoard} />;
}
