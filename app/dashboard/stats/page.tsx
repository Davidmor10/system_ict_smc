import { redirect } from 'next/navigation';

// /dashboard/stats merged into /dashboard/analytics
export default function StatsPage() {
  redirect('/dashboard/analytics');
}
