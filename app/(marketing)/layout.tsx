import { MarketingLangProvider } from './components/LangProvider';
import MarketingNav from './components/MarketingNav';
import MarketingFooter from './components/MarketingFooter';

/* Inline script runs before React hydration — prevents RTL flash on first load */
const antiFlash = `(function(){try{var l=localStorage.getItem('onyx_landing_lang')||'he';document.documentElement.lang=l;document.documentElement.dir=l==='he'?'rtl':'ltr';}catch(e){}})();`;

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarketingLangProvider>
      {/* eslint-disable-next-line @next/next/no-before-interactive-script-component */}
      <script dangerouslySetInnerHTML={{ __html: antiFlash }} />
      <MarketingNav />
      <main className="min-h-screen" style={{ background: 'var(--bg)', color: '#fff' }}>
        {children}
      </main>
      <MarketingFooter />
    </MarketingLangProvider>
  );
}
