/** Glassmorphic empty-state card — explains *why* the data matters instead of a bare "no data" line. */
export default function EmptyState({
  icon = '◈',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="relative rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-8 flex flex-col items-center text-center gap-3 overflow-hidden transition-all duration-200 hover:border-white/15">
      <div className="absolute inset-0 bg-gradient-to-br from-[#d4af37]/[0.06] to-transparent pointer-events-none" />
      <span className="text-3xl text-[#d4af37]/40 relative">{icon}</span>
      <h3 className="font-serif text-lg font-bold text-white/80 relative">{title}</h3>
      <p className="font-mono text-xs text-white/40 max-w-xs leading-relaxed relative">{description}</p>
      {action && <div className="relative mt-1">{action}</div>}
    </div>
  );
}
