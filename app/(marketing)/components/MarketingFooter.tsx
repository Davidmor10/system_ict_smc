'use client';

import Link from 'next/link';
import { useMarketingLang } from './LangProvider';

const FOOTER_LINKS = [
  { he: 'תקנון',       en: 'Terms',       href: '/terms' },
  { he: 'פרטיות',      en: 'Privacy',     href: '/privacy' },
  { he: 'הסרת אחריות', en: 'Disclaimer',  href: '/disclaimer' },
  { he: 'יצירת קשר',  en: 'Contact',     href: '/contact' },
] as const;

export default function MarketingFooter() {
  const { lang } = useMarketingLang();
  const rtl = lang === 'he';

  const copyright = lang === 'he'
    ? '© 2026 Onyx Trading · למטרות לימוד בלבד. אין באמור ייעוץ או המלצה פיננסית.'
    : '© 2026 Onyx Trading · For educational purposes only. Not financial advice.';

  return (
    <footer
      dir={rtl ? 'rtl' : 'ltr'}
      className="border-t border-[var(--border)]"
      style={{ padding: '46px 0' }}
    >
      <div className="wrap flex flex-col sm:flex-row items-center justify-between gap-4">
        <p style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 400, color: 'rgba(255,255,255,.3)' }}>
          {copyright}
        </p>

        <nav className="flex items-center gap-6">
          {FOOTER_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="transition-colors duration-200 uppercase hover:text-[var(--gold)]"
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '.06em',
                color: 'rgba(255,255,255,.4)',
              }}
            >
              {lang === 'he' ? link.he : link.en}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
