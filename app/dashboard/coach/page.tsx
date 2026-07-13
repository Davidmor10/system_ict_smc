'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import InsightText from '../../components/InsightText';
import TypingDots from '../../components/TypingDots';

interface Msg { role: 'user' | 'assistant'; content: string; }
interface ChatSummary { id: string; title: string; updatedAt: string; }

/** Premium opening line shown at the top of every fresh chat. */
const WELCOME =
  'ברוך הבא ל-Onyx Trainer.\n' +
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

const PIN_STORE = 'onyx.coach.pinned';

/** Reveal easing shared by the entrance animations (fast-in, slow-out). */
const EASE_REVEAL: [number, number, number, number] = [0.16, 1, 0.3, 1];
/** Spring-ish overshoot used by the pin toggle. */
const EASE_SPRING: [number, number, number, number] = [0.34, 1.56, 0.64, 1];

export default function CoachPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inputFocused, setInputFocused] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChatSummary | null>(null);
  const [search, setSearch] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const reduce = useReducedMotion();

  async function refreshChats() {
    try {
      const res = await fetch('/api/ai/coach/chats');
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data?.chats)) setChats(data.chats);
    } catch { /* list is best-effort — chat still works without it */ }
  }

  useEffect(() => { refreshChats(); }, []);

  // Pins live on the device (no server column) — cheap, instant, survives reload.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PIN_STORE);
      if (raw) setPinnedIds(JSON.parse(raw));
    } catch { /* ignore corrupt store */ }
    if (typeof window !== 'undefined' && window.innerWidth < 1024) setSidebarOpen(false);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  function persistPins(next: string[]) {
    setPinnedIds(next);
    try { localStorage.setItem(PIN_STORE, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function togglePin(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    persistPins(pinnedIds.includes(id) ? pinnedIds.filter(x => x !== id) : [...pinnedIds, id]);
  }

  function newChat() {
    setActiveChatId(null);
    setMessages([]);
    if (typeof window !== 'undefined' && window.innerWidth < 1024) setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function openChat(id: string) {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) setSidebarOpen(false);
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

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    setChats(cs => cs.filter(c => c.id !== target.id));
    if (pinnedIds.includes(target.id)) persistPins(pinnedIds.filter(x => x !== target.id));
    if (target.id === activeChatId) newChat();
    try { await fetch(`/api/ai/coach/chats/${target.id}`, { method: 'DELETE' }); } catch { /* ignore */ }
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
  const q = search.trim().toLowerCase();
  const matchQ = (c: ChatSummary) => !q || c.title.toLowerCase().includes(q);
  const pinnedChats = chats.filter(c => pinnedIds.includes(c.id) && matchQ(c));
  const recentChats = chats.filter(c => !pinnedIds.includes(c.id) && matchQ(c));

  // ── One chat row, shared by the Pinned and Recents lists ──────────────
  function ChatRow(c: ChatSummary) {
    const active = c.id === activeChatId;
    const pinned = pinnedIds.includes(c.id);
    return (
      <div
        key={c.id}
        onClick={() => openChat(c.id)}
        className="group relative flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer"
        style={{
          transition: 'background-color 400ms cubic-bezier(0.16,1,0.3,1), box-shadow 400ms cubic-bezier(0.16,1,0.3,1)',
          background: pinned
            ? 'rgba(212,175,55,0.09)'
            : active ? 'rgba(212,175,55,0.13)' : 'transparent',
          boxShadow: pinned ? 'inset -2px 0 0 0 #d4af37' : 'none',
        }}
        onMouseEnter={e => { if (!pinned && !active) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
        onMouseLeave={e => { if (!pinned && !active) e.currentTarget.style.background = 'transparent'; }}
      >
        {pinned ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#d4af37]"><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${active ? 'text-[#d4af37]' : 'text-white/35'}`}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        )}
        <p className={`min-w-0 flex-1 truncate text-[13px] font-bold ${active ? 'text-white' : 'text-zinc-300'}`}>{c.title}</p>

        {/* hover actions — pin + delete */}
        <div className="shrink-0 flex items-center gap-0.5">
          <motion.button
            onClick={e => togglePin(c.id, e)}
            whileTap={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.35, ease: EASE_SPRING }}
            className={`p-1 rounded-md transition-all duration-300 hover:bg-white/[0.08] ${
              pinned ? 'text-[#d4af37] opacity-100' : 'text-white/40 opacity-0 group-hover:opacity-100 hover:text-[#d4af37]'
            }`}
            aria-label={pinned ? 'בטל נעיצה' : 'נעץ שיחה'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></svg>
          </motion.button>
          <button
            onClick={e => { e.stopPropagation(); setDeleteTarget(c); }}
            className="p-1 rounded-md text-white/40 opacity-0 group-hover:opacity-100 hover:text-[#c98080] hover:bg-white/[0.08] transition-all duration-300"
            aria-label="מחק שיחה"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></svg>
          </button>
        </div>
      </div>
    );
  }

  // ── Sidebar body — shared by the desktop rail and the mobile drawer ───
  const sidebarBody = (
    <div className="flex flex-col h-full w-[260px]">
      {/* Top row — inline collapse toggle + search */}
      <div className="px-3 pt-3 flex items-center gap-2">
        <button
          onClick={() => setSidebarOpen(false)}
          className="shrink-0 w-9 h-9 grid place-items-center rounded-lg text-white/55 hover:text-[#d4af37] hover:bg-white/[0.05] transition-all duration-300"
          aria-label="הסתר שיחות"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="9" y1="4" x2="9" y2="20" /></svg>
        </button>
        <div className="flex-1 flex items-center gap-2 px-3 h-9 rounded-lg bg-black/40 border border-[#1c1c1e]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/35"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש שיחות"
            className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] font-bold text-white placeholder-white/35"
          />
        </div>
      </div>

      {/* Single new-chat button — full width, bold, above the lists */}
      <div className="px-3 pt-2 pb-1">
        <button
          onClick={newChat}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/30 text-[#d4af37] font-black text-[13.5px] hover:bg-[#d4af37]/16 hover:border-[#d4af37]/50 transition-all duration-300"
          style={{ boxShadow: '0 0 24px -10px rgba(212,175,55,0.35)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" /></svg>
          צ׳אט חדש
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {/* Pinned — collapsible */}
        {pinnedChats.length > 0 && (
          <div className="mb-1">
            <button
              onClick={() => setPinnedCollapsed(v => !v)}
              className="w-full flex items-center gap-1.5 px-2 py-2 text-white/45 hover:text-white/70 transition-colors"
            >
              <motion.svg
                animate={{ rotate: pinnedCollapsed ? -90 : 0 }}
                transition={{ duration: 0.25, ease: EASE_REVEAL }}
                width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              ><path d="m6 9 6 6 6-6" /></motion.svg>
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em]">נעוץ</span>
              <span className="font-mono text-[10px] text-white/30">{pinnedChats.length}</span>
            </button>
            <AnimatePresence initial={false}>
              {!pinnedCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE_REVEAL }}
                  className="overflow-hidden flex flex-col gap-0.5"
                >
                  {pinnedChats.map(ChatRow)}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Recents */}
        <div className="px-2 pt-2 pb-1.5">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">אחרונים</span>
        </div>
        <div className="flex flex-col gap-0.5">
          {recentChats.length === 0 && pinnedChats.length === 0 ? (
            <p className="text-white/35 text-[12px] font-bold text-center px-4 py-8 leading-relaxed">
              {q ? 'לא נמצאו שיחות.' : <>אין עדיין שיחות שמורות.<br />כל שיחה חדשה תישמר כאן.</>}
            </p>
          ) : recentChats.length === 0 ? (
            <p className="text-white/30 text-[11.5px] font-bold text-center px-4 py-4">{q ? 'אין תוצאות באחרונים.' : 'אין שיחות אחרונות.'}</p>
          ) : recentChats.map(ChatRow)}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex min-h-0 relative" dir="rtl">
      {/* Floating re-open toggle — shown only while the rail is collapsed */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute top-3 left-3 z-50 w-9 h-9 grid place-items-center rounded-lg bg-black/50 border border-[#1c1c1e] text-white/60 hover:text-[#d4af37] hover:border-[#d4af37]/40 transition-all duration-300"
          style={{ backdropFilter: 'blur(10px) saturate(140%)' }}
          aria-label="הצג שיחות"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="9" y1="4" x2="9" y2="20" /></svg>
        </button>
      )}

      {/* Conversation column */}
      <div className="flex-1 flex flex-col min-h-0 relative bg-[#050505] overflow-hidden">
        {/* Living background — distant lights that breathe */}
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          <motion.div
            className="absolute rounded-full blur-[130px]"
            style={{ width: 860, height: 860, top: '-22%', right: '-14%', background: 'radial-gradient(circle, rgba(212,175,55,0.10), transparent 68%)' }}
            animate={reduce ? {} : { scale: [1, 1.07, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 12, ease: 'easeInOut', repeat: Infinity }}
          />
          <motion.div
            className="absolute rounded-full blur-[120px]"
            style={{ width: 720, height: 720, bottom: '-20%', left: '-12%', background: 'radial-gradient(circle, rgba(122,143,168,0.06), transparent 70%)' }}
            animate={reduce ? {} : { scale: [1, 1.06, 1], opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 10, ease: 'easeInOut', repeat: Infinity, delay: 1.5 }}
          />
          <motion.div
            className="absolute rounded-full blur-[130px]"
            style={{ width: 780, height: 780, top: '30%', left: '20%', background: 'radial-gradient(circle, rgba(212,175,55,0.05), transparent 72%)' }}
            animate={reduce ? {} : { scale: [1, 1.05, 1], opacity: [0.4, 0.85, 0.4] }}
            transition={{ duration: 13, ease: 'easeInOut', repeat: Infinity, delay: 3 }}
          />
        </div>

        {/* Header */}
        <div className="relative z-10 flex items-center justify-end gap-2.5 px-4 sm:px-8 h-[60px] pl-16 shrink-0">
          <span className="font-mono text-[10px] font-bold text-white/30 tracking-[0.14em] hidden sm:inline">היומן שלך + עולם המסחר</span>
          <h1 className="font-serif text-[17px] text-white whitespace-nowrap">Onyx Trainer</h1>
          <span className="text-[#d4af37] text-[15px]">◈</span>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto px-4 sm:px-8 py-6">
          <div className="max-w-3xl mx-auto w-full flex flex-col gap-4">
            {isEmpty && (
              <>
                {/* Glass welcome card */}
                <motion.div
                  initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.7, ease: EASE_REVEAL }}
                  className="self-start max-w-[94%] px-6 py-5"
                  style={{
                    background: 'rgba(13,13,15,0.42)',
                    backdropFilter: 'blur(22px) saturate(150%)',
                    WebkitBackdropFilter: 'blur(22px) saturate(150%)',
                    border: '1px solid rgba(28,28,30,0.6)',
                    borderRadius: 24,
                    boxShadow: '0 0 44px -14px rgba(212,175,55,0.22), inset 0 1px 0 rgba(255,255,255,0.06), 0 30px 60px -24px rgba(0,0,0,0.85)',
                  }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[#d4af37] text-[13px]">◈</span>
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#d4af37]/80">Onyx Trainer</span>
                  </div>
                  {WELCOME.split('\n').map((line, i) => (
                    i === 0 ? (
                      <h2
                        key={i}
                        className="font-serif text-[21px] mb-2 leading-snug"
                        style={{
                          background: 'linear-gradient(270deg, #d4af37, #ffffff)',
                          WebkitBackgroundClip: 'text',
                          backgroundClip: 'text',
                          color: 'transparent',
                        }}
                      >
                        {line}
                      </h2>
                    ) : (
                      <p key={i} className="text-[15px] font-bold leading-relaxed text-zinc-300">{line}</p>
                    )
                  ))}
                </motion.div>

                {/* Prompt pills — self-assembling stagger */}
                <motion.div
                  className="flex flex-wrap gap-2 pt-1"
                  initial="hidden"
                  animate="show"
                  variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.2 } } }}
                >
                  {SUGGESTIONS.map(s => (
                    <motion.button
                      key={s}
                      onClick={() => send(s)}
                      variants={{
                        hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
                        show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: EASE_REVEAL } },
                      }}
                      whileHover={{ scale: 1.02 }}
                      className="onyx-pill px-4 py-2 rounded-full bg-black/50 border border-[#222] text-zinc-400 text-[12.5px] font-bold"
                    >
                      {s}
                    </motion.button>
                  ))}
                </motion.div>
              </>
            )}

            {messages.map((m, i) => (
              m.role === 'user' ? (
                <div key={i} className="self-end max-w-[85%] rounded-2xl rounded-tr-sm bg-[#d4af37]/12 border border-[#d4af37]/25 px-4 py-2.5">
                  <p className="text-[14px] font-bold text-white leading-relaxed whitespace-pre-wrap">{m.content}</p>
                </div>
              ) : (
                <div
                  key={i}
                  className="self-start max-w-[90%] rounded-2xl rounded-tl-sm px-4 py-3"
                  style={{ background: 'rgba(13,13,15,0.5)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid #1c1c1e' }}
                >
                  <div className="flex items-center gap-2 mb-1.5"><span className="text-[#d4af37] text-[11px]">◈</span><span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#d4af37]/70">Onyx</span></div>
                  <InsightText text={m.content} className="text-[14.5px] font-bold text-zinc-300 leading-relaxed" />
                </div>
              )
            ))}

            {loading && (
              <div
                className="self-start rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2.5"
                style={{ background: 'rgba(13,13,15,0.5)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid #1c1c1e' }}
              >
                <TypingDots /><span className="font-mono text-[11px] font-bold text-white/35">חושב...</span>
              </div>
            )}
          </div>
        </div>

        {/* Floating input dock */}
        <div className="relative z-10 px-4 sm:px-8 pb-5 pt-1">
          <form onSubmit={e => { e.preventDefault(); send(input); }} className="max-w-3xl mx-auto w-full">
            <div
              className="flex items-end gap-2.5 px-3 py-2.5"
              style={{
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(28px) saturate(150%)',
                WebkitBackdropFilter: 'blur(28px) saturate(150%)',
                borderRadius: 22,
                border: inputFocused ? '1px solid rgba(212,175,55,0.5)' : '1px solid rgba(28,28,30,0.7)',
                boxShadow: inputFocused
                  ? '0 0 0 3px rgba(212,175,55,.15), 0 0 40px -8px rgba(212,175,55,.35)'
                  : '0 20px 50px -22px rgba(0,0,0,0.85)',
                transition: 'box-shadow 400ms cubic-bezier(0.16,1,0.3,1), border-color 400ms cubic-bezier(0.16,1,0.3,1)',
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="שאל על היומן שלך או על עולם המסחר..."
                rows={1}
                dir="rtl"
                className="flex-1 resize-none bg-transparent px-2 py-2 text-sm font-bold text-white placeholder-white/35 outline-none max-h-32"
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="onyx-send shrink-0 h-[42px] px-5 rounded-full bg-[#d4af37] text-black font-black text-sm hover:bg-[#e3c768] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300"
              >
                שלח
              </button>
            </div>
          </form>
          <p className="max-w-3xl mx-auto w-full mt-2.5 font-mono text-[10px] font-bold text-white/30 leading-relaxed text-center">
            המאמן משלב ניתוח של היומן שלך עם ידע כללי בעולם המסחר. אין לו נתוני שוק חיים — לתאריכים ושעות מדויקים בדוק יומן כלכלי. אינו נותן תחזיות שוק או המלצות קנייה/מכירה. המסחר כרוך בסיכון.
          </p>
        </div>
      </div>

      {/* Persistent chat rail (desktop) — slides out, not squished */}
      <div
        className="hidden lg:block shrink-0 overflow-hidden bg-[#0a0a0b] border-r border-[#1c1c1e]"
        style={{ width: sidebarOpen ? 260 : 0, transition: 'width 420ms cubic-bezier(0.16,1,0.3,1)' }}
      >
        <div style={{ opacity: sidebarOpen ? 1 : 0, transition: 'opacity 260ms ease' }}>
          {sidebarBody}
        </div>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            className="lg:hidden absolute inset-0 z-40 flex"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setSidebarOpen(false)}
          >
            <div className="flex-1 bg-black/50 backdrop-blur-[2px]" />
            <motion.aside
              onClick={e => e.stopPropagation()}
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.35, ease: EASE_REVEAL }}
              className="h-full bg-[#0a0a0b] border-r border-[#1c1c1e]"
            >
              {sidebarBody}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            className="absolute inset-0 z-[60] grid place-items-center px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setDeleteTarget(null)}
            style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          >
            <motion.div
              onClick={e => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.94, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 6 }}
              transition={{ duration: 0.28, ease: EASE_REVEAL }}
              className="w-full max-w-[380px] p-6 rounded-3xl"
              style={{
                background: 'rgba(13,13,15,0.9)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(28,28,30,0.8)',
                boxShadow: '0 30px 70px -20px rgba(0,0,0,0.9)',
              }}
            >
              <h3 className="font-serif text-[19px] text-white mb-2">למחוק צ׳אט?</h3>
              <p className="text-[13.5px] font-bold text-zinc-400 leading-relaxed mb-6">
                השיחה <span className="text-white">״{deleteTarget.title}״</span> תימחק לצמיתות. אי אפשר לשחזר אותה.
              </p>
              <div className="flex items-center justify-start gap-2.5">
                <button
                  onClick={confirmDelete}
                  className="onyx-danger px-5 py-2.5 rounded-full bg-[#8b3a3a] text-white font-black text-[13px] transition-all duration-300"
                >
                  מחק
                </button>
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="px-5 py-2.5 rounded-full border border-[#2a2a2d] text-zinc-300 font-bold text-[13px] hover:text-white hover:border-white/30 transition-all duration-300"
                >
                  ביטול
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
