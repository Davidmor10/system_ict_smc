import Sidebar from '../components/Sidebar';
import SplashIntro from '../components/SplashIntro';
import MobileNav from '../components/MobileNav';
import MobileHeader from '../components/MobileHeader';
import PageTransition from '../components/PageTransition';
import ViewportScale from '../components/ViewportScale';
import { PlanProvider } from '../components/PlanProvider';
import { auth } from '@clerk/nextjs/server';
import { getSessionId, getUserRole } from '../lib/getUserRole';
import { localOwnerScript } from '../lib/localOwner';
import { requirePlan } from '../lib/withRoleCheck';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Onyx has no free tier. This is the single gate every dashboard route
  // passes through, so a new page cannot be added without it — an account
  // with no subscription is sent to checkout before any of this renders.
  await requirePlan('starter');
  const role = await getUserRole();
  const splashScope = (await getSessionId()) ?? undefined;
  const { userId } = await auth();
  return (
    <PlanProvider role={role}>
      {/* The local cache belongs to one account. This empties it when a
          different one signs in, and it runs BEFORE hydration — React effects
          run children-first, so any component reading localStorage on mount
          would already have read the previous account's journal. */}
      <script dangerouslySetInnerHTML={{ __html: localOwnerScript(userId) }} />
      {/* Same overlay, same session key: whichever screen the visit starts
          on shows it, and only that one. Someone deep-linking straight to
          the dashboard gets the opening; someone who arrived through the
          landing page does not get it twice. */}
      <SplashIntro scope={splashScope} />
      {/* Renders nothing; keeps the layout at the size it was designed for. */}
      <ViewportScale />
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
