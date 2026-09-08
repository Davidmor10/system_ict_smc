// Reading the portfolio a request is about.
//
// The client sends it as a query parameter (GET) or in the body (POST). It is
// never trusted: resolveScope checks it against the trader's own portfolios
// and falls back to the adopting one if it is not theirs.

/** `?account=pf_…` off a request URL. Null when absent or empty. */
export function accountIdFrom(req: Request): string | null {
  try {
    const v = new URL(req.url).searchParams.get('account');
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** The same value out of a parsed JSON body. */
export function accountIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const v = (body as { account?: unknown }).account;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
