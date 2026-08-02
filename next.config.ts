import type { NextConfig } from "next";

// Third-party origins the app actually talks to — keep this list in sync
// with whichever providers get added later. Everything else is denied.
const CLERK_ORIGINS = 'https://*.clerk.accounts.dev https://*.clerk.com';
const STRIPE_SCRIPT = 'https://js.stripe.com';
const STRIPE_FRAME = 'https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com';
const STRIPE_CONNECT = 'https://api.stripe.com';
const SUPABASE_CONNECT = 'https://*.supabase.co wss://*.supabase.co';
// Gemini File API — the Trade Review feature uploads videos directly from the
// browser to Google's resumable-upload endpoint so it bypasses Vercel's 4.5MB
// serverless body limit. Without this in connect-src the browser CSP blocks
// the request before it leaves the page.
const GEMINI_CONNECT = 'https://generativelanguage.googleapis.com';

const csp = [
  `default-src 'self'`,
  // Next.js/Clerk/Stripe.js all rely on inline bootstrap/hydration scripts;
  // a nonce-based CSP would be stricter but needs per-request middleware
  // wiring — worth doing later, not blocking this pass.
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${CLERK_ORIGINS} ${STRIPE_SCRIPT}`,
  // React's inline style={{...}} props render as literal style="" attributes,
  // which CSP governs as inline styles — 'unsafe-inline' is required here or
  // most of the app's layout (built entirely on inline styles) breaks.
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: https:`,
  `font-src 'self' data:`,
  `connect-src 'self' ${CLERK_ORIGINS} ${STRIPE_CONNECT} ${SUPABASE_CONNECT} ${GEMINI_CONNECT}`,
  `frame-src ${STRIPE_FRAME} ${CLERK_ORIGINS}`,
  `frame-ancestors 'self'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self' ${STRIPE_FRAME}`,
].join('; ');

const nextConfig: NextConfig = {
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
