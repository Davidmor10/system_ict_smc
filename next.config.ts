import type { NextConfig } from "next";

// Third-party origins the app actually talks to — keep this list in sync
// with whichever providers get added later. Everything else is denied.
//
// THE PUBLISHABLE KEY CARRIES THE HOST, SO READ IT RATHER THAN GUESS
//
// A development Clerk instance serves its frontend API from
// `<something>.clerk.accounts.dev`, which the wildcard below covers. A
// PRODUCTION instance serves it from the app's own domain — `clerk.example.com`
// — which matches neither `*.clerk.accounts.dev` nor `*.clerk.com`. So the day
// this deployment swaps its test keys for live ones, this CSP would have
// blocked Clerk outright and every page would have failed to load its session.
//
// Clerk encodes that host inside the publishable key: `pk_test_` / `pk_live_`
// followed by base64 of the host with a trailing `$`. Decoding it here means
// the policy follows the key instead of being edited by hand on the one day
// nobody would think to.
function clerkFrontendApi(): string {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  const encoded = key.replace(/^pk_(test|live)_/, '');
  if (!encoded || encoded === key) return '';
  try {
    const host = Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '');
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : '';
  } catch {
    return '';
  }
}

const CLERK_ORIGINS = [
  'https://*.clerk.accounts.dev',
  'https://*.clerk.com',
  clerkFrontendApi(),
].filter(Boolean).join(' ');

// Clerk's bot protection on sign-up is Cloudflare Turnstile, which loads its
// script and renders its widget in a frame from this origin. It was missing,
// so every sign-up attempt showed "The CAPTCHA failed to load. This may be due
// to an unsupported browser or a browser extension" — blaming the visitor's
// browser for a header this app sends. Nobody could create an account.
const TURNSTILE = 'https://challenges.cloudflare.com';
const STRIPE_SCRIPT = 'https://js.stripe.com';
const STRIPE_FRAME = 'https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com';
const STRIPE_CONNECT = 'https://api.stripe.com';
const SUPABASE_CONNECT = 'https://*.supabase.co wss://*.supabase.co';
// The workspace music panel frames a YouTube player. Frame-src only — the
// player's own scripts run inside that frame under YouTube's CSP, not ours, and
// the search call goes to our own route, so nothing is added to script-src or
// connect-src. youtube-nocookie is what the panel actually builds; www.youtube
// is here because some embeds redirect to it.
const YOUTUBE_FRAME = 'https://www.youtube-nocookie.com https://www.youtube.com';

const csp = [
  `default-src 'self'`,
  // Next.js/Clerk/Stripe.js all rely on inline bootstrap/hydration scripts;
  // a nonce-based CSP would be stricter but needs per-request middleware
  // wiring — worth doing later, not blocking this pass.
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${CLERK_ORIGINS} ${TURNSTILE} ${STRIPE_SCRIPT}`,
  // React's inline style={{...}} props render as literal style="" attributes,
  // which CSP governs as inline styles — 'unsafe-inline' is required here or
  // most of the app's layout (built entirely on inline styles) breaks.
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: https:`,
  `font-src 'self' data:`,
  `connect-src 'self' ${CLERK_ORIGINS} ${TURNSTILE} ${STRIPE_CONNECT} ${SUPABASE_CONNECT}`,
  `frame-src ${STRIPE_FRAME} ${CLERK_ORIGINS} ${TURNSTILE} ${YOUTUBE_FRAME}`,
  `frame-ancestors 'self'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self' ${STRIPE_FRAME}`,
].join('; ');

const nextConfig: NextConfig = {
  // The commit the client bundle was built from, exposed to the browser.
  //
  // The AI panels cache their phrased results in localStorage, keyed by the
  // day and by a fingerprint of the trades. Neither changes when the CODE
  // changes — so a deploy that fixes the wording left the old wording sitting
  // in the browser of anyone who had already opened the page that day, and the
  // page never asked the server again. Folding the build into the key means a
  // deploy retires its own stale text instead of waiting for midnight.
  env: {
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
  },

  // /fractal-engine described a market-reading engine that produced a scored
  // daily bias. No such thing exists in the product — the bias is a direction
  // the trader declares — so the page is gone. Anything still linking to it
  // lands on the feature tour instead of a 404.
  async redirects() {
    return [{ source: '/fractal-engine', destination: '/features', permanent: true }];
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
