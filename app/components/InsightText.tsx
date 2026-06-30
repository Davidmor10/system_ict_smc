import { highlightSMC } from '../lib/highlightSMC';

/** Renders AI insight text — auto-detects "• " bullet lines and lays them out as a list, with ICT/SMC terms highlighted gold. */
export default function InsightText({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const isBulleted = lines.length > 1 && lines.every(l => l.startsWith('•') || l.startsWith('-'));

  if (isBulleted) {
    return (
      <ul className={`list-none space-y-1.5 ${className}`}>
        {lines.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-[#d4af37] shrink-0">•</span>
            <span>{highlightSMC(l.replace(/^[•-]\s*/, ''))}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <p className={className}>{highlightSMC(text)}</p>;
}
