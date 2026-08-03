import type { NextConfig } from "next";

// Third-party origins the app actually talks to — keep this list in sync
// with whichever providers get added later. Everything else is denied.
const CLERK_ORIGINS = 'https://*.clerk.accounts.dev https://*.clerk.com';
const STRIPE_SCRIPT = 'https://js.stripe.com';
const STRIPE_FRAME = 'https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com';
const STRIPE_CONNECT = 'https://api.stripe.com';
const SUPABASE_CONNECT = 'https://*.supabase.co wss://*.supabase.co';
// Vercel Blob — the trade-review browser upload goes directly here (bypasses
// Vercel's 4.5MB serverless body cap). Includes:
//  - blob.vercel-storage.com (bare host used by the multipart /mpu lifecycle:
//    init, upload-part, complete)
//  - *.blob.vercel-storage.com (per-store storage subdomains)
//  - *.public.blob.vercel-storage.com (public store variant, kept for future)
// The wildcard `*.blob.vercel-storage.com` alone does NOT match the bare
// blob.vercel-storage.com host — CSP wildcards require at least one label
// before the wildcard suffix — so multipart uploads silently hang without
// the bare-host entry.
const VERCEL_BLOB_CONNECT = 'https://blob.vercel-storage.com https://*.blob.vercel-storage.com https://*.public.blob.vercel-storage.com';

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
  `connect-src 'self' ${CLERK_ORIGINS} ${STRIPE_CONNECT} ${SUPABASE_CONNECT} ${VERCEL_BLOB_CONNECT}`,
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
