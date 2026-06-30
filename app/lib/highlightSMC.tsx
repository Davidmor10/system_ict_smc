import React from 'react';

/** ICT/SMC vocabulary worth calling out in AI-generated coaching text. */
const SMC_TERMS = [
  'Liquidity Sweep', 'Order Block', 'Mitigation Block',
  'iFVG', 'IFVG', 'FVG', 'BSL', 'SSL', 'SMT',
  'CHoCH', 'BOS', 'MSS', 'PDH', 'PDL', 'PWH', 'PWL',
];

const sorted = [...SMC_TERMS].sort((a, b) => b.length - a.length);
const escaped = sorted.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const SMC_RE = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
const lowerSet = new Set(sorted.map(t => t.toLowerCase()));

/** Splits text and wraps recognized ICT/SMC terms in a highlight span. */
export function highlightSMC(text: string, className = 'text-[#d4af37] font-bold'): React.ReactNode {
  if (!text) return text;
  const parts = text.split(SMC_RE);
  return parts.map((part, i) =>
    lowerSet.has(part.toLowerCase())
      ? <span key={i} className={className}>{part}</span>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );
}
