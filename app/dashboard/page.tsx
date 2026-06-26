import { getUserRole } from '../lib/getUserRole';
import DashboardView from '../components/DashboardView';

export default async function DashboardPage() {
  const role = await getUserRole();
  return <DashboardView role={role} />;
}
