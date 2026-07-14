'use client';

import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const EASE_REVEAL: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Shared destructive-action confirmation modal. One look for every "delete"
    in the app (chat, trade, setup, rule) so nothing is removed by an accidental
    click. Renders nothing until `open` is true; fades/scales in and out. */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'מחק',
  cancelLabel = 'ביטול',
  onConfirm,
  onCancel,
  dir = 'rtl',
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  dir?: 'rtl' | 'ltr';
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center px-6"
          dir={dir}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onCancel}
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
            <h3 className="font-serif text-[19px] text-white mb-2">{title}</h3>
            <div className="text-[13.5px] font-bold text-zinc-400 leading-relaxed mb-6">{message}</div>
            <div className="flex items-center justify-start gap-2.5">
              <button
                onClick={onConfirm}
                className="onyx-danger px-5 py-2.5 rounded-full bg-[#8b3a3a] text-white font-black text-[13px] transition-all duration-300"
              >
                {confirmLabel}
              </button>
              <button
                onClick={onCancel}
                className="px-5 py-2.5 rounded-full border border-[#2a2a2d] text-zinc-300 font-bold text-[13px] hover:text-white hover:border-white/30 transition-all duration-300"
              >
                {cancelLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
