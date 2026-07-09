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
  const [search, setSearch] = useState('');
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
  const filtered = search.trim()
    ? chats.filter(c => c.title.toLowerCase().includes(search.trim().toLowerCase()))
    : chats;

  // Shared sidebar body — rendered both in the persistent desktop rail and the
  // mobile drawer, so the two never drift apart.
  const sidebarBody = (
    <>
      <div className="px-3 pt-3 flex flex-col gap-1.5">
        <button
          onClick={newChat}
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-white/85 hover:bg-white/[0.05] transition-colors text-[13.5px]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[#d4af37]"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
          צ׳אט חדש
        </button>
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[#111] border border-[#1f1f1f]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-white/35"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש שיחות"
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-white placeholder-white/30"
          />
        </div>
      </div>

      <div className="px-4 pt-4 pb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">אחרונים</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-0.5">
        {filtered.length === 0 ? (
          <p className="text-white/30 text-[12px] text-center px-4 py-8 leading-relaxed">
            {search.trim() ? 'לא נמצאו שיחות.' : <>אין עדיין שיחות שמורות.<br />כל שיחה חדשה תישמר כאן.</>}
          </p>
        ) : filtered.map(c => (
          <div
            key={c.id}
            onClick={() => openChat(c.id)}
            className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
              c.id === activeChatId ? 'bg-[#d4af37]/10' : 'hover:bg-white/[0.05]'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={c.id === activeChatId ? 'text-[#d4af37]' : 'text-white/30'}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <p className={`min-w-0 flex-1 truncate text-[13px] ${c.id === activeChatId ? 'text-white' : 'text-white/75'}`}>{c.title}</p>
            <button
              onClick={e => deleteChat(c.id, e)}
              className="shrink-0 opacity-0 group-hover:opacity-100 text-white/30 hover:text-[#ef4444] transition-all text-[13px]"
              aria-label="מחק שיחה"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div className="flex-1 flex min-h-0" dir="rtl">
      {/* Conversation column */}
      <div
        className="flex-1 flex flex-col min-h-0 relative"
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
            <button
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden text-white/60 hover:text-white text-lg leading-none -ml-1 pr-1"
              aria-label="פתח שיחות"
            >
              ☰
            </button>
            <span className="text-[#d4af37]">◈</span>
            <h1 className="font-serif text-[17px] font-bold text-white whitespace-nowrap">Onyx Trainer</h1>
            <span className="font-mono text-[10px] text-white/30 tracking-[0.14em] hidden sm:inline">היומן שלך + עולם המסחר</span>
          </div>
          <button
            onClick={newChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#d4af37]/30 text-[#d4af37] font-mono text-[11px] uppercase tracking-[0.12em] hover:bg-[#d4af37]/10 transition-colors shrink-0"
          >
            <span className="text-[13px] leading-none">＋</span> צ׳אט חדש
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
          <div className="max-w-3xl mx-auto w-full flex flex-col gap-4">
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
      </div>

      {/* Persistent chat rail (desktop) */}
      <aside className="hidden lg:flex w-[260px] shrink-0 flex-col min-h-0 bg-[#0a0a0b] border-r border-[#1c1c1e]">
        {sidebarBody}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden absolute inset-0 z-30 flex" onClick={() => setDrawerOpen(false)}>
          <div className="flex-1 bg-black/50 backdrop-blur-[2px]" />
          <aside
            onClick={e => e.stopPropagation()}
            className="w-[280px] max-w-[82vw] h-full bg-[#0a0a0b] border-l border-[#1c1c1e] flex flex-col"
          >
            <div className="flex items-center justify-between px-4 h-[60px] border-b border-[#1c1c1e] shrink-0">
              <span className="font-serif text-[15px] font-bold text-white">השיחות שלי</span>
              <button onClick={() => setDrawerOpen(false)} className="text-white/40 hover:text-white text-lg leading-none">✕</button>
            </div>
            {sidebarBody}
          </aside>
        </div>
      )}
    </div>
  );
}
