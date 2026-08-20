/**
 * Reject a cross-origin POST to a state-changing auth endpoint — login-CSRF /
 * session-fixation defense for the magic-link callback.
 *
 * Fails OPEN when the browser sends neither signal: some older Safari builds and
 * privacy proxies strip `Origin`/`Sec-Fetch-*`, and sign-in must not lock those
 * users out. The trade is deliberate — this is defense-in-depth on top of the
 * gesture gate, not the only guard.
 */
export function isCrossOriginPost(req: Request): boolean {
  const secFetchSite = req.headers.get('sec-fetch-site')
  if (secFetchSite) {
    // Browsers set this on every request. Our confirm form posts same-origin; a
    // cross-site (or same-site) auto-POST, and the never-legitimate `none` on a
    // POST, are not ours.
    return secFetchSite !== 'same-origin'
  }

  const origin = req.headers.get('origin')
  if (origin) {
    // Compare the Origin host against the request's own host (Host header when
    // present, else the request URL). A literal `null` origin fails the URL parse
    // and is rejected.
    const host = req.headers.get('host') ?? new URL(req.url).host
    try {
      return new URL(origin).host !== host
    } catch {
      return true
    }
  }

  // Neither header present → fail open.
  return false
}
