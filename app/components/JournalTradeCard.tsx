'use client';

import type { TradeEntry } from '../lib/journal';
import { tradePnL } from '../lib/journal';
import { calcRR } from '../lib/calc/trade';
import { pointValue } from '../lib/instruments';
import { SESS } from '../lib/sessions';
import { UNSPECIFIED_MODEL } from '../lib/journal';

const BULLISH = '#4a7c59';
const BEARISH = '#8b3a3a';
const GOLD = '#d4af37';

const BIAS_HE: Record<string, string> = { BULLISH: 'עולה', BEARISH: 'יורד', INDECISIVE: 'ניטרלי' };

const usd = (n: number) => {
  const a = Math.abs(n).toLocaleString('en-US');
  return n > 0 ? '+$' + a : n < 0 ? '-$' + a : '$0';
};
const money = (n: number) => '$' + Math.abs(n).toLocaleString('en-US');
const price = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pnlColor = (n: number) => (n > 0 ? BULLISH : n < 0 ? BEARISH : 'rgba(255,255,255,0.4)');

/** A trade whose entry time falls between the tracked session windows carries
    session 'NONE' (or empty). That's a real state, not a bug — render it as
    such instead of leaking the raw "NONE" token to the trader. */
function isTrackedSession(sessionKey: string): boolean {
  return !!sessionKey && sessionKey !== 'NONE' && SESS.some(s => s.key === sessionKey);
}
function sessionLabel(sessionKey: string): string {
  return SESS.find(s => s.key === sessionKey)?.he ?? sessionKey;
}

export default function JournalTradeCard({
  trade: t, onDelete, onEdit,
}: {
  trade: TradeEntry;
  onDelete?: (id: number) => void;
  /** Opens the trade in the full edit form. Result buttons and any other
      changes live inside the form itself now (moved out of the card). */
  onEdit?: (trade: TradeEntry) => void;
}) {
  const isLong = t.direction === 'LONG';
  const dirC = isLong ? BULLISH : BEARISH;
  const dirBg = isLong ? 'rgba(74,124,89,0.12)' : 'rgba(139,58,58,0.12)';
  const hasTag = !!t.model && t.model !== UNSPECIFIED_MODEL;

  const pnl = tradePnL(t);
  const resC = t.result === 'WIN' ? BULLISH : t.result === 'LOSS' ? BEARISH : t.result === 'BE' ? GOLD : 'rgba(255,255,255,0.55)';
  const resHeb = t.result === 'WIN' ? 'פרופיט' : t.result === 'LOSS' ? 'הפסד' : t.result === 'BE' ? 'ברייק איוון' : 'פתוחה';
  const resBg = t.result === 'WIN' ? 'rgba(74,124,89,0.1)' : t.result === 'LOSS' ? 'rgba(139,58,58,0.1)' : t.result === 'BE' ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.03)';
  const resBd = t.result === 'WIN' ? 'rgba(74,124,89,0.35)' : t.result === 'LOSS' ? 'rgba(139,58,58,0.35)' : t.result === 'BE' ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.1)';
  const pnlText = pnl === null ? '—' : usd(pnl);
  const pnlC = pnl === null ? 'rgba(255,255,255,0.4)' : pnlColor(pnl);

  const lo = Math.min(t.stop, t.entry, t.target);
  const hi = Math.max(t.stop, t.entry, t.target);
  const span = hi - lo || 1;
  const pct = (x: number) => Math.round(((x - lo) / span) * 1000) / 10;
  const entryPct = pct(t.entry);
  const stopPct = pct(t.stop);
  const targetPct = pct(t.target);

  const rewardLeft = Math.min(entryPct, targetPct);
  const rewardW = Math.abs(targetPct - entryPct);
  const riskLeft = Math.min(entryPct, stopPct);
  const riskW = Math.abs(stopPct - entryPct);

  const ptVal = pointValue(t.symbol);
  const riskUsd = Math.abs(t.entry - t.stop) * ptVal * (t.contracts || 1);
  const rewardUsd = Math.abs(t.target - t.entry) * ptVal * (t.contracts || 1);
  const rr = calcRR(t.entry, t.stop, t.target);

  const leftHeb = isLong ? 'סטופ' : 'יעד';
  const leftPrice = isLong ? price(t.stop) : price(t.target);
  const leftColor = isLong ? BEARISH : BULLISH;
  const rightHeb = isLong ? 'יעד' : 'סטופ';
  const rightPrice = isLong ? price(t.target) : price(t.stop);
  const rightColor = isLong ? BULLISH : BEARISH;

  return (
    <div
      className="group relative rounded-[14px] border border-[#1c1c1e] bg-[#0d0d0f] py-6 px-[30px] ps-[34px] overflow-hidden transition-all duration-[250ms] hover:border-[#d4af37]/30 hover:[box-shadow:0_16px_44px_-22px_rgba(212,175,55,0.35)]"
    >
      <div className="absolute inset-y-0 start-0 w-1" style={{ background: dirC }} />

      {/* Header row */}
      <div className="flex items-start justify-between gap-6 mb-[22px]">
        <div className="flex items-center gap-[13px] flex-wrap">
          <span style={{ fontFamily: 'var(--serif)' }} className="text-[30px] font-bold text-white leading-none">{t.symbol}</span>
          <span className="inline-flex items-center gap-1.5 text-[13px] font-bold rounded-full py-[5px] px-[13px] border" style={{ color: dirC, background: dirBg, borderColor: dirC }}>
            <span className="text-[11px]">{isLong ? '▲' : '▼'}</span>{isLong ? 'לונג' : 'שורט'}
          </span>
          <span className="text-[13px] text-white/55">{t.contracts} חוזים</span>
          {hasTag && (
            <span className="font-mono text-[11px] font-bold tracking-[0.1em] text-[#d4af37] bg-[#d4af37]/[0.08] border border-[#d4af37]/30 rounded-sm py-1 px-[11px]">{t.model}</span>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="inline-flex items-center gap-2.5 rounded-full py-2 px-[18px] border" style={{ background: resBg, borderColor: resBd }}>
            <span className="w-[9px] h-[9px] rounded-full" style={{ background: resC }} />
            <span className="text-sm font-bold" style={{ color: resC }}>{resHeb}</span>
            <span className="font-mono text-[22px] font-black tabular-nums tracking-[-0.01em]" style={{ color: pnlC }}>{pnlText}</span>
          </div>
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(t)}
              aria-label="ערוך עסקה"
              title="עריכה מלאה"
              className="inline-flex items-center gap-1.5 py-2 px-3 rounded-sm border border-[#2a2a2d] text-[12px] font-bold text-white/70 hover:text-[#d4af37] hover:border-[#d4af37]/40 transition-all"
            >
              <span className="text-[13px]">✎</span> ערוך
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(t.id)}
              aria-label="מחק עסקה"
              className="opacity-40 group-hover:opacity-100 font-mono text-xs text-white/40 hover:text-[#8b3a3a] transition-all px-1"
            >✕</button>
          )}
        </div>
      </div>


      {/* Price ladder (LTR) */}
      <div dir="ltr" className="mb-5">
        <div className="flex justify-between mb-[11px]">
          <div className="text-left">
            <div dir="rtl" className="text-xs font-semibold mb-[3px]" style={{ color: leftColor }}>{leftHeb}</div>
            <div className="font-mono text-base font-bold text-white/90 tabular-nums">{leftPrice}</div>
          </div>
          <div className="text-center">
            <div dir="rtl" className="text-xs font-semibold mb-[3px] text-[#d4af37]">כניסה</div>
            <div className="font-mono text-base font-bold text-white tabular-nums">{price(t.entry)}</div>
          </div>
          <div className="text-right">
            <div dir="rtl" className="text-xs font-semibold mb-[3px]" style={{ color: rightColor }}>{rightHeb}</div>
            <div className="font-mono text-base font-bold text-white/90 tabular-nums">{rightPrice}</div>
          </div>
        </div>
        <div className="relative h-2 rounded-[5px] bg-[#1c1c1e]">
          <div className="absolute top-0 h-2 rounded-[5px]" style={{ left: `${riskLeft}%`, width: `${riskW}%`, background: 'rgba(139,58,58,0.65)' }} />
          <div className="absolute top-0 h-2 rounded-[5px]" style={{ left: `${rewardLeft}%`, width: `${rewardW}%`, background: 'rgba(74,124,89,0.75)' }} />
          <div className="absolute -top-[5px] w-0.5 h-[18px] bg-[#d4af37] [box-shadow:0_0_8px_rgba(212,175,55,0.85)]" style={{ left: `${entryPct}%`, transform: 'translateX(-50%)' }} />
        </div>
      </div>

      {/* Risk / Reward / RR tiles */}
      <div className="flex gap-3 mb-5">
        <div className="flex-1 rounded-[10px] py-[13px] px-4 border border-[#8b3a3a]/35 bg-[#8b3a3a]/10">
          <div className="text-xs text-white/55 mb-1.5">סיכון</div>
          <div className="font-mono text-[19px] font-extrabold tabular-nums text-[#8b3a3a]">{money(riskUsd)}</div>
        </div>
        <div className="flex-1 rounded-[10px] py-[13px] px-4 border border-[#4a7c59]/35 bg-[#4a7c59]/10">
          <div className="text-xs text-white/55 mb-1.5">רווח פוטנציאלי</div>
          <div className="font-mono text-[19px] font-extrabold tabular-nums text-[#4a7c59]">{money(rewardUsd)}</div>
        </div>
        <div className="flex-1 rounded-[10px] py-[13px] px-4 border border-[#d4af37]/30 bg-[#d4af37]/[0.08]">
          <div className="text-xs text-white/55 mb-1.5">יחס סיכוי/סיכון</div>
          <div className="font-mono text-[19px] font-extrabold tabular-nums text-[#d4af37]">{rr === null ? '—' : rr.toFixed(2)}</div>
        </div>
      </div>

      {/* Footer meta */}
      <div className="flex items-center gap-[18px] pt-4 border-t border-[#1c1c1e] flex-wrap">
        <span className="font-mono text-xs font-semibold text-white/40 tabular-nums">{t.time}</span>
        <span className="w-1 h-1 rounded-full bg-white/30" />
        <span className="text-[13px] text-white/55">{isTrackedSession(t.session) ? `סשן ${sessionLabel(t.session)}` : 'מחוץ לחלונות הסשן'}</span>
        <span className="w-1 h-1 rounded-full bg-white/30" />
        <span className="text-[13px] text-white/55">ביאס יומי <span className="font-semibold" style={{ color: t.bias === 'BULLISH' ? BULLISH : t.bias === 'BEARISH' ? BEARISH : 'rgba(255,255,255,0.55)' }}>{BIAS_HE[t.bias] ?? t.bias}</span></span>
        {!hasTag && (
          <>
            <span className="w-1 h-1 rounded-full bg-white/30" />
            <span className="text-[13px] text-white/30">ללא תגית סטאפ</span>
          </>
        )}
      </div>
    </div>
  );
}

