export default function AnalyticsPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-12">
      <span className="text-4xl">🧠</span>
      <h1 className="font-mono font-bold text-xl text-[#f4f4f5] tracking-tight">
        Market Analytics
      </h1>
      <p className="font-mono text-[13px] text-[#71717a] max-w-sm leading-6">
        HTF breakdown, premium/discount arrays, and institutional orderflow maps.
        <br />
        <span className="text-[#3b82f6]">Coming in the next phase.</span>
      </p>
    </div>
  );
}
