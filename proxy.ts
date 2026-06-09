// Next.js 16 Proxy (formerly Middleware) — Clerk authentication gate.
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// Routes that require a signed-in user.
const isProtectedRoute = createRouteMatcher(['/dashboard(.*)', '/checkout(.*)']);

const withClerk = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect();
});

// Until Clerk keys are configured, run as a transparent pass-through so the app
// stays fully functional. Once CLERK_SECRET_KEY is set, auth protection activates.
const proxy = process.env.CLERK_SECRET_KEY ? withClerk : () => NextResponse.next();

export default proxy;

export const config = {
  matcher: [
    // Skip Next internals and static assets, run on everything else.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|gif|png|svg|ico|webp|woff2?|ttf|map)).*)',
    '/(api|trpc)(.*)',
  ],
};
