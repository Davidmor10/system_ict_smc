'use client';

import { useEffect, useRef, useState } from 'react';
import { loadTrades } from '../../lib/journal';
import EmptyState from '../../components/EmptyState';
import InsightText from '../../components/InsightText';
import TypingDots from '../../components/TypingDots';

const CHAT_STORAGE_KEY = 'onyx_coach_chat';
const MIN_CLOSED = 3;

interface Msg { role: 'user' | 'assistant'; content: string; }

const SUGGESTIONS = [
  'מה הסשן הכי חזק שלי?',
  'איפה אני מפסיד הכי הרבה כסף?',
  'איך המצב הרגשי שלי משפיע על התוצאות?',
  'האם אני חותך מנצחים מוקדם מדי?',
];

const REASON_MESSAGE: Record<string, string> = {
  not_configured: 'החיבור לענן עדיין לא מוגדר, אז אין לי גישה לנתוני היומן שלך.',
  insufficient_data: 'עדיין אין לי מספיק עסקאות סגורות כדי לענות בביטחון. תחזור אליי אחרי כמה עסקאות.',
  ai_unavailable: 'לא הצלחתי להגיע ל-AI כרגע. נסה שוב עוד רגע.',
};

function loadChat(): Msg[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((m): m is Msg => m?.role && typeof m?.content === 'string') : [];
  } catch {
    return [];
  }
}

export default function CoachPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [closedCount, setClosedCount] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(loadChat());
    setClosedCount(loadTrades().filter(t => t.result !== 'OPEN').length);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-40))); } catch {}
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;
    const history = messages.slice(-6);
    const next = [...messages, { role: 'user' as const, content: question }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, lang: 'he', history }),
      });
      const data = await res.json().catch(() => ({}));
      const answer = typeof data?.answer === 'string' && data.answer
        ? data.answer
        : REASON_MESSAGE[data?.reason as string] ?? 'משהו השתבש. נסה שוב.';
      setMessages(m => [...m, { role: 'assistant', content: answer }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: REASON_MESSAGE.ai_unavailable }]);
    } finally {
      setLoading(false);
    }
  }

  function clearChat() {
    setMessages([]);
    try { localStorage.removeItem(CHAT_STORAGE_KEY); } catch {}
  }

  const notEnough = closedCount !== null && closedCount < MIN_CLOSED;

  return (
    <div
      className="flex-1 flex flex-col min-h-0"
      dir="rtl"
      style={{
        background: `
          radial-gradient(60% 60% at 100% 0%, rgba(212,175,55,0.05), transparent 70%),
          radial-gradient(55% 60% at 0% 100%, rgba(122,143,168,0.04), transparent 70%),
          #050505`,
      }}
    >
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-4 px-6 sm:px-8 h-[60px] bg-[rgba(5,5,5,.82)] backdrop-blur-md border-b border-[#1c1c1e]">
        <div className="flex items-center gap-2.5">
          <span className="text-[#d4af37]">◈</span>
          <h1 className="font-serif text-[17px] font-bold text-white">מאמן AI</h1>
          <span className="font-mono text-[10px] text-white/30 tracking-[0.14em] hidden sm:inline">מבוסס על היומן שלך בלבד</span>
        </div>
        {messages.length > 0 && (
          <button onClick={clearChat} className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35 hover:text-[#ef4444] transition-colors">
            נקה שיחה
          </button>
        )}
      </div>

      {notEnough ? (
        <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-8 max-w-3xl mx-auto w-full">
          <EmptyState
            icon="◈"
            title="המאמן צריך עוד קצת נתונים"
            description={`אני מנתח אך ורק את היומן שלך — בלי לנחש. תרשום לפחות ${MIN_CLOSED} עסקאות סגורות ואז אוכל לענות על שאלות על הביצועים שלך.`}
          />
        </div>
      ) : (
        <>
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
            <div className="max-w-3xl mx-auto w-full flex flex-col gap-4">
              {messages.length === 0 && (
                <div className="pt-6">
                  <p className="text-[15px] text-white/55 leading-relaxed mb-5">
                    שאל אותי כל דבר על היומן שלך. אני עונה רק לפי הנתונים האמיתיים שלך — עם אחוזי הצלחה וכמות עסקאות, בלי לנחש ובלי תחזיות שוק.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map(s => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="px-3.5 py-2 rounded-xl border border-[#222] text-white/60 font-mono text-[12px] hover:text-[#d4af37] hover:border-[#d4af37]/40 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                m.role === 'user' ? (
                  <div key={i} className="self-end max-w-[85%] rounded-2xl rounded-tr-sm bg-[#d4af37]/12 border border-[#d4af37]/25 px-4 py-2.5">
                    <p className="text-[14px] text-white leading-relaxed">{m.content}</p>
                  </div>
                ) : (
                  <div key={i} className="self-start max-w-[90%] rounded-2xl rounded-tl-sm bg-[#0a0a0b] border border-[#1c1c1e] px-4 py-3">
                    <div className="flex items-center gap-2 mb-1.5"><span className="text-[#d4af37] text-[11px]">◈</span><span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#d4af37]/70">Onyx</span></div>
                    <InsightText text={m.content} className="text-[14.5px] text-[#c8c8c8] leading-relaxed" />
                  </div>
                )
              ))}

              {loading && (
                <div className="self-start rounded-2xl rounded-tl-sm bg-[#0a0a0b] border border-[#1c1c1e] px-4 py-3 flex items-center gap-2.5">
                  <TypingDots /><span className="font-mono text-[11px] text-white/35">מנתח את היומן שלך...</span>
                </div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="border-t border-[#1c1c1e] bg-[rgba(5,5,5,.9)] backdrop-blur-md px-4 sm:px-8 py-4">
            <form
              onSubmit={e => { e.preventDefault(); send(input); }}
              className="max-w-3xl mx-auto w-full flex items-end gap-2.5"
            >
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="שאל על היומן שלך..."
                rows={1}
                dir="rtl"
                className="flex-1 resize-none bg-[#111] border border-[#222] rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none focus:border-[#d4af37]/50 focus:ring-2 focus:ring-[#d4af37]/10 transition-all max-h-32"
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="shrink-0 h-[46px] px-5 rounded-xl bg-[#d4af37] text-black font-mono text-sm font-bold hover:bg-[#e5c84a] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                שלח
              </button>
            </form>
            <p className="max-w-3xl mx-auto w-full mt-2.5 font-mono text-[10px] text-white/25 leading-relaxed text-center">
              המאמן מנתח את היומן שלך בלבד ואינו נותן תחזיות שוק או המלצות קנייה/מכירה. המסחר כרוך בסיכון.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
