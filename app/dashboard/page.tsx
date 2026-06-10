import DashboardWorkspace from '../components/DashboardWorkspace';
import UpgradeBanner from '../components/UpgradeBanner';
import AdvancedFeatures from '../components/AdvancedFeatures';
import { getUserRole } from '../lib/getUserRole';

// Server Component: resolves the viewer's role server-side (defaults to 'free'
// when Clerk/Supabase aren't configured), then renders the role-appropriate
// banner above the client-only workspace.
export default async function DashboardPage() {
  const role = await getUserRole();

  return (
    <>
      {role === 'pro' ? <AdvancedFeatures /> : <UpgradeBanner />}
      <DashboardWorkspace />
    </>
  );
}
