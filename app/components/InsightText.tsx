import { highlightSMC } from '../lib/highlightSMC';

/** The coach is told to write plain prose, but models still slip in Markdown.
    Strip the emphasis markers so "**CPI**" never renders as literal asterisks. */
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[*]\s+/gm, '• '); // normalize "* item" to a real bullet
}

/** Renders AI insight text as a mentor would write it: clean paragraphs with
    breathing room (never one collapsed block), Markdown stripped, and ICT/SMC
    terms highlighted gold. Falls back to a real list only when the whole text
    is genuinely bulleted. */
export default function InsightText({ text, className = '' }: { text: string; className?: string }) {
  const lines = stripMarkdown(text).split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const isBulleted = lines.length > 1 && lines.every(l => l.startsWith('•') || l.startsWith('-') || /^\d+\.\s/.test(l));

  if (isBulleted) {
    return (
      <ul className={`list-none space-y-1.5 ${className}`}>
        {lines.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-[#d4af37] shrink-0">•</span>
            <span>{highlightSMC(l.replace(/^([•-]|\d+\.)\s*/, ''))}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={`space-y-2.5 ${className}`}>
      {lines.map((l, i) => <p key={i}>{highlightSMC(l)}</p>)}
    </div>
  );
}
