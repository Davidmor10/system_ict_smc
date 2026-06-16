import Sidebar from '../components/Sidebar';
import MobileNav from '../components/MobileNav';
import PageTransition from '../components/PageTransition';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex overflow-hidden bg-[#050505] text-[#c0c0c0]">
      <Sidebar />
      <PageTransition>{children}</PageTransition>
      <MobileNav />
    </div>
  );
}
