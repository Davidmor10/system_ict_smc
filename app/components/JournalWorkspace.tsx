'use client';

import dynamic from 'next/dynamic';

// Client wrapper so JournalView keeps ssr:false (localStorage-backed) while the
// page itself stays a Server Component that can gate access.
const JournalView = dynamic(() => import('./JournalView'), { ssr: false });

export default function JournalWorkspace() {
  return <JournalView />;
}
