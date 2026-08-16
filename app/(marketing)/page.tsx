import { auth } from '@clerk/nextjs/server';
import Landing from './components/Landing';
import MemberHome from './components/MemberHome';
import { getUserRole } from '../lib/getUserRole';

// "/" is two pages behind one address.
//
// Signed out it is the pitch. Signed in it is a doorway — who you are, what
// plan you hold, and the way in or out. Selling a subscription to someone who
// already bought one is the clearest possible signal that the product has not
// noticed them.
//
// The split happens on the server so a paying visitor never sees a frame of
// the sales page before it is swapped out.

// Both keys, not just the secret: MemberHome calls Clerk client hooks, and the
// root layout only mounts <ClerkProvider> when the publishable key is present.
// Rendering it without the provider would throw on hydration.
const CLERK_ENABLED =
  !!process.env.CLERK_SECRET_KEY && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default async function HomePage() {
  if (!CLERK_ENABLED) return <Landing />;

  const { userId } = await auth();
  if (!userId) return <Landing />;

  return <MemberHome role={await getUserRole()} />;
}
