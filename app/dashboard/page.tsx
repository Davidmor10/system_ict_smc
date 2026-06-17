import DashboardWorkspace from '../components/DashboardWorkspace';
import MacroBoard from '../components/NewsWidget';
import { getUserRole } from '../lib/getUserRole';
import { currentUser } from '@clerk/nextjs/server';

const OWNER_EMAIL = 'davidmor030908@gmail.com';

export default async function DashboardPage() {
  const [role, user] = await Promise.all([getUserRole(), currentUser().catch(() => null)]);
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? '';
  const isOwner = email === OWNER_EMAIL;
  return <DashboardWorkspace role={role} isOwner={isOwner} macroBoard={<MacroBoard />} />;
}
