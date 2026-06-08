import Sidebar from '../components/Sidebar';
import { LanguageProvider } from '../hooks/useLanguage';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LanguageProvider>
      <div className="h-screen flex overflow-hidden bg-[#050505] text-[#c0c0c0]">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {children}
        </div>
      </div>
    </LanguageProvider>
  );
}
