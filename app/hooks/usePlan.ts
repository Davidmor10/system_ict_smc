'use client';

import { useUser } from '@clerk/nextjs';

// Emails that are always granted Deluxe, regardless of billing metadata.
const DELUXE_EMAILS = ['davidmor030908@gmail.com'];

/**
 * Deluxe-privilege check. Returns true when the signed-in user is either an
 * override email or carries `publicMetadata.plan === 'deluxe'`. Returns false
 * while Clerk is still loading or when no user is signed in (fail-closed).
 *
 * Must be called from within <ClerkProvider> (a Client Component subtree).
 */
export function usePlan(): boolean {
  const { isLoaded, isSignedIn, user } = useUser();

  if (!isLoaded || !isSignedIn || !user) return false;

  const email = user.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (email && DELUXE_EMAILS.includes(email)) return true;

  return user.publicMetadata?.plan === 'deluxe';
}
