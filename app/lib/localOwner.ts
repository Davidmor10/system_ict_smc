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
  return `(function(){try{
var id=${id},P=${prefixes},K=${keep},k='${LOCAL_OWNER_KEY}';
if(!id)return;
var cur=localStorage.getItem(k);
if(cur===id)return;
var d=[],i,n;
for(i=0;i<localStorage.length;i++){n=localStorage.key(i);
if(n&&n!==k&&K.indexOf(n)<0&&P.some(function(p){return n.indexOf(p)===0;}))d.push(n);}
for(i=0;i<d.length;i++)localStorage.removeItem(d[i]);
localStorage.setItem(k,id);
}catch(e){}})();`;
}
