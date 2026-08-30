import { auth } from '@clerk/nextjs/server';
import { MarketingLangProvider } from '../(marketing)/components/LangProvider';
import MarketingNav from '../(marketing)/components/MarketingNav';
import MarketingFooter from '../(marketing)/components/MarketingFooter';

// "/" has its own layout — and its own route group — for one reason.
//
// It is two pages behind one address: signed out it is the pitch, signed in it
// is the entry gate, which carries its own header and footer. Deciding between
// them needs auth(), and auth() in a layout makes every route under that layout
// dynamic. Left in the shared marketing layout it would have dragged
// /features, /performance and /pricing off the static path with it, for a
// question that only concerns this one address.
//
// "/" was already dynamic — its page calls auth() to choose what to render — so
// the check costs nothing here.

const CLERK_ENABLED =
  !!process.env.CLERK_SECRET_KEY && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/* Inline script runs before React hydration — prevents RTL flash on first load */
const antiFlash = `(function(){try{var l=localStorage.getItem('onyx_landing_lang')||'he';document.documentElement.lang=l;document.documentElement.dir=l==='he'?'rtl':'ltr';}catch(e){}})();`;

export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  // Decided on the server, not from useAuth() in the bar: Clerk resolves
  // `isSignedIn` a beat after hydration, so a client-side check would paint the
  // duplicate header and then yank it away.
  const signedIn = CLERK_ENABLED ? !!(await auth()).userId : false;

  return (
    <MarketingLangProvider>
      <script dangerouslySetInnerHTML={{ __html: antiFlash }} />
      <MarketingNav signedIn={signedIn} />
      <main className="min-h-screen" style={{ background: 'var(--bg)', color: '#fff' }}>
        {children}
      </main>
      <MarketingFooter signedIn={signedIn} />
    </MarketingLangProvider>
  );
}
