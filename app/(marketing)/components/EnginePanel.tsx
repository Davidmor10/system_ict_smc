'use client';

import { useMarketingLang } from './LangProvider';

const D = {
  live:   { he: 'חי',         en: 'Live' },
  bias_l: { he: 'ביאס יומי', en: 'Daily Bias' },
  bias_v: { he: 'עולה',       en: 'BULLISH' },
  bias_m: { he: 'לונדון ← ניו יורק AM · המשכיות', en: 'London → NY AM · Continuation' },
  c_tl:   { he: 'מגמה',       en: 'Trend' },
  c_tv:   { he: 'עולה',       en: 'Bullish' },
  c_cl:   { he: 'אישור',      en: 'Confirm' },
  c_cv:   { he: 'IFVG 2M',    en: 'IFVG 2M' },
  c_sl:   { he: 'סטאפ',       en: 'Setup' },
  c_sv:   { he: 'המשכיות',    en: 'Continuation' },
  c_el:   { he: 'סשן',        en: 'Session' },
  c_ev:   { he: 'NY AM',      en: 'NY AM' },
} as const;

type DK = keyof typeof D;

export default function EnginePanel() {
  const { lang } = useMarketingLang();
  const t = (k: DK): string => (D[k] as { he: string; en: string })[lang];

  const cells = [
    { l: t('c_tl'), v: t('c_tv'), gold: true  },
    { l: t('c_cl'), v: t('c_cv'), gold: true  },
    { l: t('c_sl'), v: t('c_sv'), gold: false },
    { l: t('c_el'), v: t('c_ev'), gold: false },
  ];

  return (
    <div
      className="relative rounded-xl border overflow-hidden"
      style={{
        background: 'rgba(13,13,15,.6)',
        borderColor: 'var(--border2)',
        boxShadow: '0 0 70px -10px rgba(212,175,55,.12), inset 0 0 0 1px rgba(255,255,255,.03)',
      }}
    >
      {/* corner glow */}
      <div aria-hidden className="absolute top-0 end-0 w-52 h-52 pointer-events-none"
        style={{ background: 'radial-gradient(circle at top right, rgba(212,175,55,.08), transparent 70%)' }} />

      {/* header */}
      <div className="relative z-10 flex items-center justify-between px-5 py-3.5 border-b"
        style={{ borderColor: 'var(--border2)', background: 'rgba(0,0,0,.35)' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.65)', textTransform: 'uppercase', letterSpacing: '.18em' }}>
          Fractal Engine · ES
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: 'var(--bull-t)' }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: 'var(--bull-t)', textTransform: 'uppercase', letterSpacing: '.18em' }}>
            {t('live')}
          </span>
        </span>
      </div>

      {/* body */}
      <div className="relative z-10 p-5">
        {/* bias box */}
        <div className="rounded-lg border p-5" style={{ background: '#000', borderColor: 'var(--border2)' }}>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.22em', color: 'rgba(255,255,255,.36)' }}>
            {t('bias_l')}
          </p>
          <p className="mt-2" dir="ltr"
            style={{ fontFamily: 'var(--serif)', fontSize: 46, fontWeight: 800, lineHeight: 1, color: 'var(--bull-t)' }}>
            {t('bias_v')}
          </p>
          <p className="mt-1.5" dir="ltr"
            style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'rgba(255,255,255,.36)', letterSpacing: '.08em' }}>
            {t('bias_m')}
          </p>
          {/* confidence bars */}
          <div className="flex gap-1.5 mt-4" dir="ltr">
            {[true, true, true, false].map((on, i) => (
              <div key={i} className="h-1.5 flex-1 rounded-full"
                style={{ background: on ? 'var(--gold)' : 'rgba(255,255,255,.12)' }} />
            ))}
          </div>
        </div>

        {/* 2×2 cells */}
        <div className="grid grid-cols-2 mt-3 gap-px" style={{ background: 'var(--border2)' }}>
          {cells.map((c, i) => (
            <div key={i} className="p-3.5" style={{ background: '#000' }}>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(255,255,255,.28)' }}>
                {c.l}
              </p>
              <p dir="ltr" className="mt-1"
                style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: c.gold ? 'var(--gold)' : 'rgba(255,255,255,.82)' }}>
                {c.v}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
