'use client';

import { useLanguage } from '../hooks/useLanguage';

export default function LegalDisclaimer() {
  const { t, lang } = useLanguage();

  return (
    <footer className="border-t border-[#1c1c1e] bg-[#000000] px-6 py-10" dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <div className="max-w-4xl mx-auto">
        <h4 className="text-sm font-bold font-mono text-[#d4af37] uppercase tracking-[0.2em] mb-3">
          {t('legal_title')}
        </h4>
        <p className="text-sm font-medium text-white/45 leading-7 tracking-wide">
          {t('legal_body')}
        </p>
      </div>
    </footer>
  );
}
