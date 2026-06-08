'use client'

import dynamic from 'next/dynamic'

const JournalView = dynamic(() => import('../../components/JournalView'), { ssr: false })

export default function JournalPage() {
  return <JournalView />
}
