import DashboardWorkspace from '../components/DashboardWorkspace';
import MacroBoard from '../components/NewsWidget';
import { getUserRole } from '../lib/getUserRole';

export default async function DashboardPage() {
  const role = await getUserRole();
  return <DashboardWorkspace role={role} macroBoard={<MacroBoard />} />;
}
