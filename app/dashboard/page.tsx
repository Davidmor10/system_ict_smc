import DashboardWorkspace from '../components/DashboardWorkspace';
import MacroBoard from '../components/NewsWidget';
import { getUserContext } from '../lib/getUserRole';

export default async function DashboardPage() {
  const { role, isOwner } = await getUserContext();
  return <DashboardWorkspace role={role} isOwner={isOwner} macroBoard={<MacroBoard />} />;
}
