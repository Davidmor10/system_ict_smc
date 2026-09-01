/** Does this string contain Hebrew.
 *
 *  Used to decide a value's text direction at render time. The diagnostics
 *  surfaces show two different kinds of value in the same column —
 *  identifiers, emails and counts, which are left-to-right, and sentences,
 *  which are Hebrew. Forcing one direction on both renders the other
 *  reordered, and for a two-letter answer like כן, unreadable.
 *
 *  Its own module rather than an export from a page: a client component
 *  importing from a server page pulls that page's server-only imports into
 *  the browser bundle. */
export function hasHebrew(v: string): boolean {
  return /[֐-׿]/.test(v);
}
