'use client';

import Link from 'next/link';
import { useLanguage } from '../hooks/useLanguage';
import type { DictKey } from '../lib/i18n';

export interface Tier {
  id: string;
  nameKey: DictKey;
  tagKey: DictKey;
  subtitleKey: DictKey;
  featureKeys: DictKey[];
  featured: boolean;
  badgeKey?: DictKey;
}

export const TIERS: Tier[] = [
  {
    id: 'premium',
    nameKey: 'tier_premium_name',
    tagKey: 'tier_premium_tag',
    subtitleKey: 'tier_premium_sub',
    featureKeys: ['tier_premium_f1', 'tier_premium_f2', 'tier_premium_f3', 'tier_premium_f4'],
    featured: false,
  },
  {
    id: 'deluxe',
    nameKey: 'tier_deluxe_name',
    tagKey: 'tier_deluxe_tag',
    badgeKey: 'tier_deluxe_badge',
    subtitleKey: 'tier_deluxe_sub',
    featureKeys: ['tier_deluxe_f1', 'tier_deluxe_f2', 'tier_deluxe_f3', 'tier_deluxe_f4'],
    featured: true,
  },
];

export function PricingCards({
  selectedId,
  onSelect,
  ctaHref,
  ctaLabel,
}: {
  selectedId?: string;
  onSelect?: (id: string) => void;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  const { t, lang } = useLanguage();
  const label = ctaLabel ?? `${t('cta_upgrade')} ←`;

  return (
    <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto" dir={lang === 'he' ? 'rtl' : 'ltr'}>
      {TIERS.map(tier => {
        const selected = selectedId === tier.id;
        return (
          <div
            key={tier.id}
            onClick={onSelect ? () => onSelect(tier.id) : undefined}
            className={[
              'lift relative rounded-xl p-7 flex flex-col bg-[#0d0d0f]',
              tier.featured
                ? 'border border-[#d4af37] [box-shadow:0_0_60px_-12px_rgba(212,175,55,0.45)]'
                : 'border border-zinc-800',
              onSelect ? 'cursor-pointer' : '',
              selected ? 'ring-2 ring-[#d4af37] ring-offset-2 ring-offset-black' : '',
            ].join(' ')}
          >
            {tier.featured && tier.badgeKey && (
              <span className="absolute -top-3 right-7 px-3 py-1 rounded-full bg-[#d4af37] text-black text-xs font-bold tracking-wide [box-shadow:0_0_24px_rgba(212,175,55,0.6)]">
                {t(tier.badgeKey)}
              </span>
            )}

            <span className="text-xs font-bold font-mono text-[#d4af37] uppercase tracking-[0.25em]">{t(tier.tagKey)}</span>
            <h3 className="font-serif text-2xl font-bold text-white mt-2 leading-tight">{t(tier.nameKey)}</h3>
            <p className="text-base font-bold text-[#c0c0c0] mt-3 leading-relaxed">{t(tier.subtitleKey)}</p>

            <ul className="flex flex-col gap-2.5 mt-6 mb-7">
              {tier.featureKeys.map(fk => (
                <li key={fk} className="flex items-start gap-2.5">
                  <span className="text-[#d4af37] mt-0.5 shrink-0">◈</span>
                  <span className="text-base font-bold text-white/85 leading-snug">{t(fk)}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto">
              {ctaHref ? (
                <Link
                  href={ctaHref}
                  className={`flex items-center justify-center gap-2 w-full py-3.5 rounded-sm font-serif text-base font-bold transition-all duration-500 ${
                    tier.featured
                      ? 'bg-[#d4af37] text-black [box-shadow:0_0_36px_rgba(212,175,55,0.4)] hover:[box-shadow:0_0_56px_rgba(212,175,55,0.65)]'
                      : 'border border-[#d4af37]/50 text-[#d4af37] hover:bg-[#d4af37]/10 hover:border-[#d4af37]'
                  }`}
                >
                  {label}
                </Link>
              ) : (
                <span
                  className={`flex items-center justify-center gap-2 w-full py-3.5 rounded-sm font-serif text-base font-bold transition-all duration-500 ${
                    selected
                      ? 'bg-[#d4af37] text-black [box-shadow:0_0_36px_rgba(212,175,55,0.4)]'
                      : 'border border-zinc-800 text-white/70'
                  }`}
                >
                  {selected ? t('card_selected') : t('card_select')}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
