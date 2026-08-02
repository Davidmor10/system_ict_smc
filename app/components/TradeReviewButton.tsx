'use client';

// Compact CTA that hangs on a trade card. Clicking opens the review panel for
// that trade. Passive by design — no API calls fire until the panel actually
// opens (which pulls past reviews for the trade).

import { useState } from 'react';
import TradeReviewPanel from './TradeReviewPanel';

export default function TradeReviewButton({ tradeId, tradeSymbol }: { tradeId: number; tradeSymbol: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="נתח את העסקה הזאת עם AI"
        className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-sm border border-[#d4af37]/30 bg-[#d4af37]/[0.06] text-[#d4af37] text-[11.5px] font-bold hover:bg-[#d4af37]/[0.12] transition-colors"
      >
        <span>▶</span> AI Review
      </button>
      <TradeReviewPanel open={open} tradeId={tradeId} tradeSymbol={tradeSymbol} onClose={() => setOpen(false)} />
    </>
  );
}
