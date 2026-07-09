'use client';

import { useEffect, useRef, useState } from 'react';
import InsightText from '../../components/InsightText';
import TypingDots from '../../components/TypingDots';

interface Msg { role: 'user' | 'assistant'; content: string; }
interface ChatSummary { id: string; title: string; updatedAt: string; }

/** Premium opening line shown at the top of every fresh chat. */
const WELCOME =
  'ברוך הבא ל-Onyx TRAINER.\n' +
  'שאל אותי כל דבר. בין אם זו שאלה על המסחר שלך, על הנתונים האישיים שלך או על עולם המסחר – אני כאן כדי לעזור.\n' +
  'איך אפשר לעזור לך היום?';

const SUGGESTIONS = [
  'מה הסשן הכי חזק שלי?',
  'איפה אני מפסיד הכי הרבה כסף?',
  'אילו דוחות כלכליים חשובים משפיעים על השוק?',
  'מה זה FVG ואיך סוחרים אותו?',
];

const REASON_MESSAGE: Record<string, string> = {
  ai_unavailable: 'לא הצלחתי להגיע ל-AI כרגע. נסה שוב עוד רגע.',
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'עכשיו';
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.round(m / 60);
  if (h < 24) return `לפני ${h} ש׳`;
  const d = Math.round(h / 24);
  if (d < 7) return `לפני ${d} ימים`;
  return new Date(iso).toLocaleDateString('he-IL');
}

export default function CoachPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function refreshChats() {
    try {
      const res = await fetch('/api/ai/coach/chats');
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data?.chats)) setChats(data.chats);
    } catch { /* list is best-effort — chat still works without it */ }
  }

  useEffect(() => { refreshChats(); }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  function newChat() {
    setActiveChatId(null);
    setMessages([]);
    setDrawerOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function openChat(id: string) {
    setDrawerOpen(false);
    if (id === activeChatId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/coach/chats/${id}`);
      const data = await res.json().catch(() => ({}));
      const msgs: Msg[] = Array.isArray(data?.chat?.messages) ? data.chat.messages : [];
      setMessages(msgs);
      setActiveChatId(id);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: REASON_MESSAGE.ai_unavailable }]);
    } finally {
      setLoading(false);
    }
  }

  async function deleteChat(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setChats(cs => cs.filter(c => c.id !== id));
    if (id === activeChatId) newChat();
    try { await fetch(`/api/ai/coach/chats/${id}`, { method: 'DELETE' }); } catch { /* ignore */ }
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;
    const history = messages.slice(-6);
    setMessages([...messages, { role: 'user', content: question }]);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, lang: 'he', chatId: activeChatId, history }),
      });
      const data = await res.json().catch(() => ({}));
      const answer = typeof data?.answer === 'string' && data.answer
        ? data.answer
        : REASON_MESSAGE[data?.reason as string] ?? 'משהו השתבש. נסה שוב.';
      setMessages(m => [...m, { role: 'assistant', content: answer }]);
      if (typeof data?.chatId === 'string') {
        setActiveChatId(data.chatId);
        refreshChats();
      }
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: REASON_MESSAGE.ai_unavailable }]);
    } finally {
      setLoading(false);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div
      className="flex-1 flex flex-col min-h-0 relative"
      dir="rtl"
      style={{
        background: `
          radial-gradient(60% 60% at 100% 0%, rgba(212,175,55,0.05), transparent 70%),
          radial-gradient(55% 60% at 0% 100%, rgba(122,143,168,0.04), transparent 70%),
          #050505`,
      }}
    >
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-4 px-4 sm:px-8 h-[60px] bg-[rgba(5,5,5,.82)] backdrop-blur-md border-b border-[#1c1c1e]">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[#d4af37]">◈</span>
          <h1 className="font-serif text-[17px] font-bold text-white whitespace-nowrap">Onyx Trainer</h1>
          <span className="font-mono text-[10px] text-white/30 tracking-[0.14em] hidden sm:inline">היומן שלך + עולם המסחר</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={newChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#d4af37]/30 text-[#d4af37] font-mono text-[11px] uppercase tracking-[0.12em] hover:bg-[#d4af37]/10 transition-colors"
          >
            <span className="text-[13px] leading-none">＋</span> צ׳אט חדש
          </button>
          <button
            onClick={() => setDrawerOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#222] text-white/55 font-mono text-[11px] uppercase tracking-[0.12em] hover:text-white hover:border-[#333] transition-colors"
          >
            ☰ אחרונים
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
        <div className="max-w-3xl mx-auto w-full flex flex-col gap-4">
          {/* Premium opening message — shown on every fresh chat */}
          {isEmpty && (
            <>
              <div className="self-start max-w-[92%] rounded-2xl rounded-tl-sm bg-gradient-to-br from-[#12100a] to-[#0a0a0b] border border-[#d4af37]/25 px-5 py-4 shadow-[0_0_40px_-12px_rgba(212,175,55,0.25)]">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-[#d4af37] text-[13px]">◈</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#d4af37]/80">Onyx Trainer</span>
                </div>
                {WELCOME.split('\n').map((line, i) => (
                  <p key={i} className={`text-[15px] leading-relaxed ${i === 0 ? 'font-serif text-white text-[17px] mb-1.5' : 'text-[#c8c8c8]'}`}>
                    {line}
                  </p>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
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
            </>
          )}

          {messages.map((m, i) => (
            m.role === 'user' ? (
              <div key={i} className="self-end max-w-[85%] rounded-2xl rounded-tr-sm bg-[#d4af37]/12 border border-[#d4af37]/25 px-4 py-2.5">
                <p className="text-[14px] text-white leading-relaxed whitespace-pre-wrap">{m.content}</p>
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
              <TypingDots /><span className="font-mono text-[11px] text-white/35">חושב...</span>
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
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="שאל על היומן שלך או על עולם המסחר..."
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
          המאמן משלב ניתוח של היומן שלך עם ידע כללי בעולם המסחר. אין לו נתוני שוק חיים — לתאריכים ושעות מדויקים בדוק יומן כלכלי. אינו נותן תחזיות שוק או המלצות קנייה/מכירה. המסחר כרוך בסיכון.
        </p>
      </div>

      {/* "אחרונים" drawer */}
      {drawerOpen && (
        <div className="absolute inset-0 z-30 flex" onClick={() => setDrawerOpen(false)}>
          <div className="flex-1 bg-black/50 backdrop-blur-[2px]" />
          <aside
            onClick={e => e.stopPropagation()}
            className="w-[300px] max-w-[82vw] h-full bg-[#0a0a0b] border-l border-[#1c1c1e] flex flex-col"
          >
            <div className="flex items-center justify-between px-4 h-[60px] border-b border-[#1c1c1e]">
              <span className="font-serif text-[15px] font-bold text-white">אחרונים</span>
              <button onClick={() => setDrawerOpen(false)} className="text-white/40 hover:text-white text-lg leading-none">✕</button>
            </div>
            <button
              onClick={newChat}
              className="mx-3 mt-3 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-[#d4af37]/30 text-[#d4af37] font-mono text-[12px] uppercase tracking-[0.12em] hover:bg-[#d4af37]/10 transition-colors"
            >
              <span className="text-[14px] leading-none">＋</span> צ׳אט חדש
            </button>
            <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1">
              {chats.length === 0 ? (
                <p className="text-white/30 text-[12px] text-center px-4 py-8 leading-relaxed">
                  אין עדיין שיחות שמורות.<br />כל שיחה חדשה תישמר כאן.
                </p>
              ) : chats.map(c => (
                <div
                  key={c.id}
                  onClick={() => openChat(c.id)}
                  className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                    c.id === activeChatId ? 'bg-[#d4af37]/10 border border-[#d4af37]/25' : 'border border-transparent hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-white/85 truncate">{c.title}</p>
                    <p className="font-mono text-[10px] text-white/30 mt-0.5">{relTime(c.updatedAt)}</p>
                  </div>
                  <button
                    onClick={e => deleteChat(c.id, e)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-white/30 hover:text-[#ef4444] transition-all text-sm"
                    aria-label="מחק שיחה"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
