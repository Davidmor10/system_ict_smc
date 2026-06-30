/** Three pulsing dots — shown while the AI is "thinking". */
export default function TypingDots({ className = '', dotClassName = 'bg-[#d4af37]' }: { className?: string; dotClassName?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-label="typing">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${dotClassName}`}
          style={{ animation: `dp-typing-bounce 1.1s ease-in-out ${i * 0.15}s infinite` }}
        />
      ))}
    </span>
  );
}
