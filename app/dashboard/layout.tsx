import Sidebar from '../components/Sidebar';
import MobileNav from '../components/MobileNav';
import MobileHeader from '../components/MobileHeader';
import PageTransition from '../components/PageTransition';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex overflow-hidden bg-black text-[#c0c0c0]">
      <Sidebar />
      {/* Spacer pushes content below the fixed mobile header */}
      <div className="flex-1 flex flex-col min-h-0 max-[880px]:pt-[54px]">
        <PageTransition>{children}</PageTransition>
      </div>
      <MobileHeader />
      <MobileNav />
    </div>
  );
}
