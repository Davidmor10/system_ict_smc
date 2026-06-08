'use client'

import dynamic from 'next/dynamic'

const DashboardView = dynamic(() => import('../components/DashboardView'), { ssr: false })

export default function DashboardPage() {
  return <DashboardView />
}
