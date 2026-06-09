'use client';

import Link from 'next/link';

export interface Tier {
  id: string;
  name: string;
  tag: string;
  subtitle: string;
  features: string[];
  featured: boolean;
  badge?: string;
}

export const TIERS: Tier[] = [
  {
    id: 'premium',
    name: 'מנוי PREMIUM',
    tag: 'גישת מסחר מלאה',
    subtitle: 'כל הכלים שאתה צריך בשביל לסחור בלייב.',
    features: [
      'דשבורד המסחר המרכזי',
      'סינכרון גרפים חי של חוזי ES ו-NQ',
      'מחשבון ניהול סיכונים CME מובנה',
      'פאנל חדשות מאקרו בזמן אמת',
    ],
    featured: false,
  },
  {
    id: 'deluxe',
    name: 'מנוי DELUXE',
    tag: 'חבילת המקצוענים',
    badge: 'הבחירה של המקצוענים',
    subtitle: 'הגרסה המלאה והמתקדמת ביותר של המערכת.',
    features: [
      'כל יכולות מנוי ה-Premium',
      'גישה בלעדית למסך הניתוחים',
      'יומן המסחר הדיגיטלי לתיעוד עסקאות',
      'שורת מדדי הביצוע החיוניים (StatsBar)',
    ],
    featured: true,
  },
];

const DEFAULT_CTA = 'לרכישת מנוי ושדרוג המערכת ←';

export function PricingCards({
  selectedId,
  onSelect,
  ctaHref,
  ctaLabel = DEFAULT_CTA,
}: {
  selectedId?: string;
  onSelect?: (id: string) => void;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto" dir="rtl">
      {TIERS.map(t => {
        const selected = selectedId === t.id;
        return (
          <div
            key={t.id}
            onClick={onSelect ? () => onSelect(t.id) : undefined}
            className={[
              'relative rounded-xl p-7 flex flex-col bg-[#0d0d0f] transition-all duration-500',
              t.featured
                ? 'border border-[#d4af37] [box-shadow:0_0_60px_-12px_rgba(212,175,55,0.45)]'
                : 'border border-zinc-800',
              onSelect ? 'cursor-pointer' : '',
              selected ? 'ring-2 ring-[#d4af37] ring-offset-2 ring-offset-black' : '',
            ].join(' ')}
          >
            {t.featured && t.badge && (
              <span className="absolute -top-3 right-7 px-3 py-1 rounded-full bg-[#d4af37] text-black text-xs font-bold tracking-wide [box-shadow:0_0_24px_rgba(212,175,55,0.6)]">
                {t.badge}
              </span>
            )}

            <span className="text-xs font-bold font-mono text-[#d4af37] uppercase tracking-[0.25em]">{t.tag}</span>
            <h3 className="font-serif text-2xl font-bold text-white mt-2 leading-tight">{t.name}</h3>
            <p className="text-base font-bold text-[#c0c0c0] mt-3 leading-relaxed">{t.subtitle}</p>

            <ul className="flex flex-col gap-2.5 mt-6 mb-7">
              {t.features.map(f => (
                <li key={f} className="flex items-start gap-2.5">
                  <span className="text-[#d4af37] mt-0.5 shrink-0">◈</span>
                  <span className="text-base font-bold text-white/85 leading-snug">{f}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto">
              {ctaHref ? (
                <Link
                  href={ctaHref}
                  className={`flex items-center justify-center gap-2 w-full py-3.5 rounded-sm font-serif text-base font-bold transition-all duration-500 ${
                    t.featured
                      ? 'bg-[#d4af37] text-black [box-shadow:0_0_36px_rgba(212,175,55,0.4)] hover:[box-shadow:0_0_56px_rgba(212,175,55,0.65)]'
                      : 'border border-[#d4af37]/50 text-[#d4af37] hover:bg-[#d4af37]/10 hover:border-[#d4af37]'
                  }`}
                >
                  {ctaLabel}
                </Link>
              ) : (
                <span
                  className={`flex items-center justify-center gap-2 w-full py-3.5 rounded-sm font-serif text-base font-bold transition-all duration-500 ${
                    selected
                      ? 'bg-[#d4af37] text-black [box-shadow:0_0_36px_rgba(212,175,55,0.4)]'
                      : 'border border-zinc-800 text-white/70'
                  }`}
                >
                  {selected ? 'נבחר ✓' : 'בחר מסלול'}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
