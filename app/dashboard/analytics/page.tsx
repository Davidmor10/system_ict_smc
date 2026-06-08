'use client'

import dynamic from 'next/dynamic'

const AnalyticsView = dynamic(() => import('../../components/AnalyticsView'), { ssr: false })

export default function AnalyticsPage() {
  return <AnalyticsView />
}
