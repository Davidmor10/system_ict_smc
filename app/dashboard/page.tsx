import DashboardWorkspace from '../components/DashboardWorkspace';
import UpgradeBanner from '../components/UpgradeBanner';
import AdvancedFeatures from '../components/AdvancedFeatures';
import NewsWidget from '../components/NewsWidget';
import { getUserRole } from '../lib/getUserRole';

// Server Component: resolves the viewer's role server-side (defaults to 'free'
// when Clerk/Supabase aren't configured), then renders the role-appropriate
// banner above the client-only workspace. The macro feed (NewsWidget) is built
// here as a true RSC and handed to the client workspace as a prop slot.
export default async function DashboardPage() {
  const role = await getUserRole();

  return (
    <>
      {role === 'pro' ? <AdvancedFeatures /> : <UpgradeBanner />}
      <DashboardWorkspace sidebar={<NewsWidget />} />
    </>
  );
}
