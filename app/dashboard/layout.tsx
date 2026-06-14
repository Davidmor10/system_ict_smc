import Sidebar from '../components/Sidebar';

// LanguageProvider now lives in the root layout, so the dashboard simply
// consumes the shared context (no local provider needed).
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen flex overflow-hidden bg-[#050505] text-[#c0c0c0]">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
