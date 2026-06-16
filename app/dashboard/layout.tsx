import Sidebar from '../components/Sidebar';
import MobileNav from '../components/MobileNav';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex overflow-hidden bg-[#050505] text-[#c0c0c0]">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden pb-14 md:pb-0">
        {children}
      </div>
      <MobileNav />
    </div>
  );
}
