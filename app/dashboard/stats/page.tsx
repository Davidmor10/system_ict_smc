import { redirect } from 'next/navigation';

// /dashboard/stats merged into /dashboard/ai-analytics (the legacy /dashboard/analytics page was removed)
export default function StatsPage() {
  redirect('/dashboard/ai-analytics');
}
