import Sidebar from '../components/Sidebar';
import StaleSessionNotice from '../components/StaleSessionNotice';
import SplashIntro from '../components/SplashIntro';
import FirstRunGate from '../components/FirstRunGate';
import MobileNav from '../components/MobileNav';
import MobileHeader from '../components/MobileHeader';
import PageTransition from '../components/PageTransition';
import ViewportScale from '../components/ViewportScale';
import { PlanProvider } from '../components/PlanProvider';
import { PortfolioProvider } from '../components/PortfolioProvider';
import { getSessionId, getUserRole } from '../lib/getUserRole';
import { viewerIsAdmin } from '../lib/payments/admin';
import { requirePlan } from '../lib/withRoleCheck';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Onyx has no free tier. This is the single gate every dashboard route
  // passes through, so a new page cannot be added without it — an account
  // with no subscription is sent to checkout before any of this renders.
  await requirePlan('starter');
  const role = await getUserRole();
  const splashScope = (await getSessionId()) ?? undefined;
  // Only so the sidebar can show the owner their verification link. The page
  // behind it gates itself on the server.
  const isAdmin = await viewerIsAdmin();
  return (
    <PlanProvider role={role} isAdmin={isAdmin}>
      {/* Hydrated once here rather than by each consumer — the switcher writes
          the selection and every scoped screen reads it. */}
      <PortfolioProvider>
      {/* Same overlay, same session key: whichever screen the visit starts
          on shows it, and only that one. Someone deep-linking straight to
          the dashboard gets the opening; someone who arrived through the
          landing page does not get it twice. */}
      <SplashIntro scope={splashScope} />
      {/* Says so when this tab's session changed in another window, instead
          of letting it empty silently. */}
      <StaleSessionNotice />
      {/* Asks a brand-new account for the handful of settings that decide what
          every number on every screen means — the balance above all, whose
          $25,000 default is silently wrong for most traders and lives on a
          page a new user has no reason to open. Renders nothing for an account
          that has been set up, or that has trades. */}
      <FirstRunGate />
      {/* Renders nothing; keeps the layout at the size it was designed for. */}
      <ViewportScale />
      {/* The shell is the design's: one radial wash the whole frame sits on,
          and a rail with no border that the wash shows straight through. The
          rail is authored FIRST and the document is RTL, so it lands on the
          right without a mirrored order. */}
      <div className="onyx-layout onyx-shell h-screen flex overflow-hidden text-[#cbcbd3]">
        <Sidebar />
        {/* Spacer pushes content below the fixed mobile header */}
        <div className="flex-1 flex flex-col min-h-0 max-[880px]:pt-[54px]">
          <PageTransition>{children}</PageTransition>
        </div>
        <MobileHeader />
        <MobileNav />
      </div>
      </PortfolioProvider>
    </PlanProvider>
  );
}
