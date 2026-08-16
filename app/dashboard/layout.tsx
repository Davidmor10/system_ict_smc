import Sidebar from '../components/Sidebar';
import MobileNav from '../components/MobileNav';
import MobileHeader from '../components/MobileHeader';
import PageTransition from '../components/PageTransition';
import { PlanProvider } from '../components/PlanProvider';
import { getUserRole } from '../lib/getUserRole';
import { requirePlan } from '../lib/withRoleCheck';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Onyx has no free tier. This is the single gate every dashboard route
  // passes through, so a new page cannot be added without it — an account
  // with no subscription is sent to checkout before any of this renders.
  await requirePlan('starter');
  const role = await getUserRole();
  return (
    <PlanProvider role={role}>
      <div className="onyx-layout h-screen flex overflow-hidden bg-black text-[#c0c0c0]">
        <Sidebar />
        {/* Spacer pushes content below the fixed mobile header */}
        <div className="flex-1 flex flex-col min-h-0 max-[880px]:pt-[54px]">
          <PageTransition>{children}</PageTransition>
        </div>
        <MobileHeader />
        <MobileNav />
      </div>
    </PlanProvider>
  );
}
