// Next.js 16 Proxy (formerly Middleware) — Clerk authentication gate.
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

// Routes that require a signed-in user.
const isProtectedRoute = createRouteMatcher(['/dashboard(.*)', '/checkout(.*)']);

const withClerk = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect();
});

const hasClerkKey = !!process.env.CLERK_SECRET_KEY;
const isProdEnv = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

if (isProdEnv && !hasClerkKey) {
  // A missing key here means /dashboard and /checkout would otherwise run
  // with zero auth check in production — a silent, total auth bypass. Make
  // it loud in the function logs instead of guessing why users can see
  // other people's data.
  console.error(
    '[SECURITY] CLERK_SECRET_KEY is missing in a production environment. ' +
    'Protected routes are being BLOCKED (not opened) until this is fixed. ' +
    'Set CLERK_SECRET_KEY in the deployment environment variables.'
  );
}

// Local/dev convenience: pass through so the app stays usable before Clerk
// keys are configured. In production, a missing key blocks protected routes
// outright (503) instead of silently opening them — the previous behavior
// (`() => NextResponse.next()` unconditionally) failed open in exactly the
// scenario that matters most: a misconfigured env var in the live deployment.
const proxy = hasClerkKey
  ? withClerk
  : isProdEnv
    ? (req: NextRequest) => {
        if (isProtectedRoute(req)) {
          return NextResponse.json({ error: 'Service misconfigured — authentication unavailable' }, { status: 503 });
        }
        return NextResponse.next();
      }
    : () => NextResponse.next();

export default proxy;

export const config = {
  matcher: [
    // Skip Next internals and static assets, run on everything else.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|gif|png|svg|ico|webp|woff2?|ttf|map)).*)',
    '/(api|trpc)(.*)',
  ],
};
