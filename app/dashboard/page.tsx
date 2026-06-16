import DashboardWorkspace from '../components/DashboardWorkspace';
import MacroBoard from '../components/NewsWidget';
import { getUserRole } from '../lib/getUserRole';

// Server Component: resolves the viewer's role server-side, passes it to the
// client workspace as a plain prop, and renders the RSC macro board as a slot.
export default async function DashboardPage() {
  const role = await getUserRole();
  return <DashboardWorkspace role={role} macroBoard={<MacroBoard />} />;
}
