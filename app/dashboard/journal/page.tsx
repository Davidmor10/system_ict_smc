export default function JournalPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-12">
      <span className="text-4xl">📓</span>
      <h1 className="font-mono font-bold text-xl text-[#f4f4f5] tracking-tight">
        Trading Journal
      </h1>
      <p className="font-mono text-[13px] text-[#71717a] max-w-sm leading-6">
        Execution logs, confluence entry records, and session review tools.
        <br />
        <span className="text-[#3b82f6]">Coming in the next phase.</span>
      </p>
    </div>
  );
}
