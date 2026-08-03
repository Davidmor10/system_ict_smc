'use client';

// TradeReviewPanel — the modal that hosts the whole feature for a single trade.
// Three phases:
//   1) Idle → shows past reviews for this trade (if any) + an upload dropzone.
//   2) Analyzing → polls GET /api/trade-review/[id] every 3s and paints progress.
//   3) Done / Failed → renders the report (or the error) with a "new review" CTA.
//
// The upload itself is a POST to /api/trade-review with multipart form data.
// All persistence lives server-side; this component holds only transient state.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { upload as blobUpload } from '@vercel/blob/client';
import type { TradeReviewRow } from '../lib/videoReview/types';
import TradeReviewReport from './TradeReviewReport';

const EASE_REVEAL: [number, number, number, number] = [0.16, 1, 0.3, 1];
const POLL_MS = 3_000;

type Phase = 'idle' | 'uploading' | 'analyzing' | 'done' | 'failed';

export default function TradeReviewPanel({
  open, tradeId, tradeSymbol, onClose,
}: {
  open: boolean;
  tradeId: number;
  tradeSymbol: string;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [pastReviews, setPastReviews] = useState<TradeReviewRow[]>([]);
  const [activeReview, setActiveReview] = useState<TradeReviewRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setActiveReview(null);
    setError(null);
    setUploadPct(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    fetch(`/api/trade-review?tradeId=${tradeId}`).then(r => r.json()).then(d => {
      const rows: TradeReviewRow[] = d.reviews ?? [];
      setPastReviews(rows);
      // If the most recent review is still analyzing (page refresh mid-run), resume polling.
      const inflight = rows.find(r => r.status === 'analyzing' || r.status === 'uploading');
      if (inflight) { setActiveReview(inflight); setPhase('analyzing'); }
    }).catch(() => {});
  }, [open, tradeId, reset]);

  // Poll while analyzing
  useEffect(() => {
    if (phase !== 'analyzing' || !activeReview) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/trade-review/${activeReview.id}`);
        if (!res.ok) return;
        const { review } = await res.json() as { review: TradeReviewRow };
        setActiveReview(review);
        if (review.status === 'done')   setPhase('done');
        if (review.status === 'failed') { setPhase('failed'); setError(review.errorMessage ?? 'הניתוח נכשל'); }
      } catch { /* keep polling */ }
    }, POLL_MS);
    return () => clearInterval(iv);
  }, [phase, activeReview]);

  async function upload(file: File) {
    setPhase('uploading');
    setUploadPct(0);
    setError(null);
    try {
      const mimeType = file.type || 'video/mp4';

      // Step 1 — PUT the video directly to Vercel Blob. The upload() helper
      // handles: hitting our /blob-upload route for a scoped client token,
      // uploading directly to Vercel Blob's CDN (bypasses Vercel serverless
      // body limit + no CORS issues), multipart for large files, and real
      // byte-level progress via onUploadProgress.
      const pathname = `trade-reviews/${tradeId}-${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
      const blob = await blobUpload(pathname, file, {
        access: 'public',
        contentType: mimeType,
        handleUploadUrl: '/api/trade-review/blob-upload',
        multipart: true,
        onUploadProgress: e => setUploadPct(e.percentage),
      });

      // Step 2 — tell our server the upload's done. Server transfers the
      // video Blob → Gemini, kicks off analysis, deletes the blob after.
      const startRes = await fetch('/api/trade-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, blobUrl: blob.url, mimeType }),
      });
      const startBody = await startRes.json();
      if (!startRes.ok) throw new Error(startBody.detail ?? startBody.error ?? 'לא הצלחנו להפעיל את הניתוח');

      setActiveReview(startBody.review);
      setPhase('analyzing');
    } catch (err) {
      setPhase('failed');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) upload(f);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[110] grid place-items-center px-4 py-8 overflow-y-auto"
          dir="rtl"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
        >
          <motion.div
            onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={{ duration: 0.3, ease: EASE_REVEAL }}
            className="w-full max-w-[860px] rounded-[20px] my-4"
            style={{
              background: 'rgba(10,10,11,0.96)',
              border: '1px solid #1c1c1e',
              boxShadow: '0 40px 90px -20px rgba(0,0,0,0.9)',
            }}
          >
            {/* Header */}
            <div className="flex items-start justify-between p-6 border-b border-[#1c1c1e]">
              <div>
                <div className="font-mono text-[10.5px] font-bold tracking-[0.28em] uppercase text-[#d4af37] mb-1.5">TRADE REVIEW · {tradeSymbol}</div>
                <h2 className="font-serif text-[24px] font-bold text-white m-0">ניתוח החלטות מבוסס וידאו</h2>
                <p className="text-[13px] text-white/50 mt-1.5 max-w-[520px]">העלה קליפ שבו אתה מסביר את העסקה. המערכת תצליב את מה שאמרת, מה שהראה הגרף, ומה שרשום ביומן — ותוציא דוח עם המקורות לכל טענה.</p>
              </div>
              <button onClick={onClose} className="text-white/40 hover:text-white text-xl leading-none">✕</button>
            </div>

            <div className="p-6 max-h-[70vh] overflow-y-auto">
              {phase === 'idle' && (
                <>
                  <UploadZone onFile={upload} inputRef={fileInputRef} onChange={onFileChange} />
                  {pastReviews.length > 0 && (
                    <div className="mt-8">
                      <div className="font-mono text-[10.5px] font-bold tracking-[0.28em] uppercase text-white/50 mb-3">ניתוחים קודמים</div>
                      <ul className="list-none p-0 m-0 flex flex-col gap-2">
                        {pastReviews.map(r => (
                          <li key={r.id}>
                            <button
                              onClick={() => { setActiveReview(r); setPhase(r.status === 'done' ? 'done' : r.status === 'failed' ? 'failed' : 'analyzing'); if (r.status === 'failed') setError(r.errorMessage ?? ''); }}
                              className="w-full text-right py-3 px-4 rounded-[10px] border border-[#1c1c1e] bg-white/[0.02] hover:border-[#d4af37]/30 transition-colors flex items-center gap-3"
                            >
                              <span className={`w-2 h-2 rounded-full ${r.status === 'done' ? 'bg-[#4a7c59]' : r.status === 'failed' ? 'bg-[#8b3a3a]' : 'bg-[#d4af37] animate-pulse'}`} />
                              <span className="text-[13px] text-white/75 flex-1">{new Date(r.createdAt).toLocaleString('he-IL')}</span>
                              <span className="text-[11.5px] text-white/50">
                                {r.status === 'done' ? 'הושלם' : r.status === 'failed' ? 'נכשל' : 'מנתח...'}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {(phase === 'uploading' || phase === 'analyzing') && (
                <AnalysisProgress phase={phase} uploadPct={uploadPct} />
              )}

              {phase === 'failed' && (
                <div className="text-center py-10">
                  <div className="text-4xl mb-4">✕</div>
                  <div className="text-[15px] text-white mb-2">הניתוח נכשל</div>
                  <div className="text-[13px] text-white/50 mb-6">{error}</div>
                  <button onClick={reset} className="py-2 px-5 rounded-sm border border-[#2a2a2d] text-white/70 hover:text-white text-[13px]">נסה שוב</button>
                </div>
              )}

              {phase === 'done' && activeReview?.report && (
                <>
                  <TradeReviewReport report={activeReview.report} />
                  <div className="mt-6 pt-4 border-t border-[#1c1c1e]">
                    <button onClick={reset} className="text-[12.5px] text-[#d4af37]/70 hover:text-[#d4af37]">+ ניתוח חדש</button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function UploadZone({
  onFile, inputRef, onChange,
}: { onFile: (f: File) => void; inputRef: React.RefObject<HTMLInputElement | null>; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault(); setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f && f.type.startsWith('video/')) onFile(f);
      }}
      className="rounded-2xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer"
      style={{ borderColor: dragging ? '#d4af37' : '#2a2a2d', background: dragging ? 'rgba(212,175,55,0.05)' : 'transparent' }}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={onChange} />
      <div className="text-4xl mb-3 text-white/40">▶</div>
      <div className="text-[15px] text-white mb-1.5">גרור לכאן וידאו של סקירת העסקה</div>
      <div className="text-[12.5px] text-white/50">MP4, MOV, WebM · עד 500MB · עד ~15 דקות</div>
    </div>
  );
}

const STAGES = [
  { label: 'מעבד את הוידאו בצד של Gemini', duration: 30 },
  { label: 'קורא את הגרף', duration: 40 },
  { label: 'מתמלל את הדיבור', duration: 30 },
  { label: 'מצליב עם היומן והחוקים', duration: 40 },
  { label: 'מרכיב את הדוח', duration: 20 },
];

/** Uploading has real byte-level progress (from XHR onprogress), analyzing
    doesn't — the pipeline reports a single 'analyzing' status, so we animate
    through expected stages at their typical durations. The analysis bar caps
    at 95% so it doesn't lie about being done. */
function AnalysisProgress({ phase, uploadPct }: { phase: 'uploading' | 'analyzing'; uploadPct: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (phase !== 'analyzing') return;
    const start = Date.now();
    const iv = setInterval(() => setElapsed((Date.now() - start) / 1000), 500);
    return () => clearInterval(iv);
  }, [phase]);

  if (phase === 'uploading') {
    return (
      <div className="py-10 text-center">
        <div className="font-mono text-[10.5px] font-bold tracking-[0.28em] uppercase text-[#d4af37] mb-2">מעלה</div>
        <h3 className="font-serif text-[22px] font-bold text-white m-0 mb-1">מעביר את הוידאו לאחסון</h3>
        <div className="text-[12.5px] text-white/50 mb-6">נא לא לסגור עד שההעלאה תסתיים.</div>
        <div className="h-1.5 rounded-full bg-[#1c1c1e] overflow-hidden mb-3 max-w-[420px] mx-auto">
          <motion.div
            className="h-full bg-[#d4af37]"
            initial={{ width: 0 }}
            animate={{ width: `${uploadPct}%` }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          />
        </div>
        <div className="font-mono text-[13px] tabular-nums text-white/60">{uploadPct.toFixed(0)}%</div>
      </div>
    );
  }

  const total = STAGES.reduce((a, b) => a + b.duration, 0);
  let cursor = 0;
  let currentIdx = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (elapsed < cursor + STAGES[i].duration) { currentIdx = i; break; }
    cursor += STAGES[i].duration;
    currentIdx = i;
  }
  const pct = Math.min(95, (elapsed / total) * 100);

  return (
    <div className="py-8">
      <div className="text-center mb-6">
        <div className="font-mono text-[10.5px] font-bold tracking-[0.28em] uppercase text-[#d4af37] mb-2">מנתח...</div>
        <h3 className="font-serif text-[22px] font-bold text-white m-0">{STAGES[currentIdx]?.label ?? 'מסיים'}</h3>
        <div className="text-[12.5px] text-white/50 mt-1.5">בדרך כלל 1-3 דקות (תלוי באורך הוידאו). תוכל לסגור ולחזור — הניתוח ממשיך ברקע.</div>
      </div>
      <div className="h-1.5 rounded-full bg-[#1c1c1e] overflow-hidden mb-6">
        <motion.div
          className="h-full bg-[#d4af37]"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
      <ul className="list-none p-0 m-0 flex flex-col gap-2 max-w-[360px] mx-auto">
        {STAGES.map((s, i) => (
          <li key={i} className="flex items-center gap-2.5 text-[13px]" style={{ color: i < currentIdx ? 'rgba(255,255,255,0.7)' : i === currentIdx ? '#d4af37' : 'rgba(255,255,255,0.35)' }}>
            <span className="w-4 text-center">{i < currentIdx ? '✓' : i === currentIdx ? '•' : '○'}</span>
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

