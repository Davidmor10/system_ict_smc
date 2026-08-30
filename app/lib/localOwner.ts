// ─────────────────────────────────────────────────────────────────────────────
// The local cache belongs to ONE account.
//
// Every list this app keeps — trades, setups, rules, the notebook, the day's
// plan — is cached in localStorage and synced from there. localStorage is keyed
// by ORIGIN, not by user. So on a shared browser, the second person to sign in
// opened the first person's journal.
//
// And it did not stop at reading. `hydrateList` merges the local copy with the
// cloud copy and pushes the result back up, so the first account's trades,
// setups and notes were written INTO the second account. Two directions, one
// missing check.
//
// Seen exactly that way: signing in as a tester showed the owner's 33 trades
// and his balance.
//
// The fix is to stamp the cache with the account it belongs to and empty it
// the moment a different account arrives — before a single component has read
// it, which is why this ships as an inline script in the layout rather than as
// an effect. React effects run children-first, so any component reading
// localStorage on mount would have read the previous account's data before a
// parent effect could clear it.
// ─────────────────────────────────────────────────────────────────────────────

export const LOCAL_OWNER_KEY = 'onyx_local_owner';

/** Where the last forced wipe is recorded. */
export const CACHE_EPOCH_KEY = 'onyx_cache_epoch';

/** Bump to empty every browser's cache once, on the next load.
 *
 *  WHY A BLUNT INSTRUMENT IS THE RIGHT ONE HERE
 *
 *  The owner envelope stops a cache from being READ by the wrong account. It
 *  cannot undo a cache that was already filled from poisoned cloud rows —
 *  because at that point the data genuinely does belong to the signed-in
 *  account, as far as anything on the device can tell.
 *
 *  That is the loop that made a database cleanup impossible to land:
 *
 *    1. the wrong journal is sitting in an account's rows in the cloud
 *    2. the browser hydrates, and correctly caches what the cloud gave it
 *    3. the rows are deleted server-side
 *    4. the browser hydrates again, finds the cloud missing everything it
 *       has, and helpfully restores it — which is exactly what an
 *       offline-first journal is supposed to do
 *
 *  No client-side rule can separate step 4 from a real offline recovery: the
 *  device cannot know whether the server lost the trades or meant to remove
 *  them. Only the operator knows, and this is how they say it. Bump the epoch
 *  AFTER the deletion and deploy: every browser starts empty against an empty
 *  cloud, and there is nothing left to restore.
 *
 *  Costs one re-hydration per device. That is all it costs, because
 *  localStorage is a cache and the cloud is the source of truth. */
export const CACHE_EPOCH = 2;

/** Prefixes of every key this app writes. */
export const APP_KEY_PREFIXES = ['onyx_', 'fractal_'] as const;

/** Keys that belong to the DEVICE, not to the account, and survive a handover.
 *
 *  Language is a browser preference — clearing it would flip a Hebrew reader
 *  to English for signing in on a colleague's laptop, which is noise, not
 *  privacy. Nothing here is derived from anyone's trading. */
export const DEVICE_KEYS = ['onyx_landing_lang'] as const;

/** The script that runs before hydration. Kept as a builder so the layout can
 *  inject the signed-in id and the test can read the same source the browser
 *  gets.
 *
 *  Written defensively throughout: a browser with localStorage disabled, or a
 *  quota error mid-clear, must not stop the page rendering. */
export function localOwnerScript(userId: string | null): string {
  const id = JSON.stringify(userId ?? '');
  const prefixes = JSON.stringify(APP_KEY_PREFIXES);
  const keep = JSON.stringify(DEVICE_KEYS);
  // Two reasons to empty the cache, one wipe. The epoch check runs first and
  // runs for everyone, signed in or not — a stale cache on a signed-out
  // browser is still the thing that gets restored the moment somebody signs
  // in.
  return `(function(){try{
var id=${id},P=${prefixes},K=${keep},k='${LOCAL_OWNER_KEY}',ek='${CACHE_EPOCH_KEY}',E='${CACHE_EPOCH}';
function wipe(){var d=[],i,n;
for(i=0;i<localStorage.length;i++){n=localStorage.key(i);
if(n&&n!==k&&n!==ek&&K.indexOf(n)<0&&P.some(function(p){return n.indexOf(p)===0;}))d.push(n);}
for(i=0;i<d.length;i++)localStorage.removeItem(d[i]);}
if(localStorage.getItem(ek)!==E){wipe();localStorage.setItem(ek,E);localStorage.removeItem(k);}
if(!id)return;
if(localStorage.getItem(k)===id)return;
wipe();
localStorage.setItem(k,id);
}catch(e){}})();`;
}
