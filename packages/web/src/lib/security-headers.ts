/**
 * Security headers (Content-Security-Policy + companions) for the web app.
 *
 * Emitted from `src/proxy.ts` (Next 16 middleware) so the mode is read from the
 * env at RUNTIME (instant rollback) — `next.config` `headers()` bakes at build.
 * The policy is STATIC (no per-request nonce): a static header does not force
 * dynamic rendering, so CDN/static caching (and `cacheComponents`) are preserved.
 *
 * Defense-in-depth only: XSS is already neutralized at the render sinks
 * (DOMPurify in the skill editor; react-markdown without rehype-raw on views).
 * Because there's no nonce, `script-src` keeps `'unsafe-inline'` and so does NOT
 * block injected inline scripts — the high value here is the whole-class
 * directives (object-src, base-uri, frame-ancestors, form-action) + tight
 * resource allowlists. The strict injected-script net (nonce or SRI) is deferred.
 */
export type CspMode = 'off' | 'report-only' | 'enforce'

/** Parse WEB_CSP_MODE; anything unrecognized/unset clamps to the safe default. */
export function resolveCspMode(raw: string | undefined): CspMode {
  if (raw === 'off' || raw === 'enforce' || raw === 'report-only') return raw
  return 'report-only'
}

/** Build the CSP value string for the given environment. */
export function buildCspValue({ isDev }: { isDev: boolean }): string {
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    // Cloudflare Web Analytics beacon (edge-injected on production).
    'https://static.cloudflareinsights.com',
    ...(isDev ? ["'unsafe-eval'"] : []),
  ]
  // Tailwind + next/font inject inline <style>; no reliable nonce/hash path, and
  // style injection is far lower-risk than script injection.
  const styleSrc = ["'self'", "'unsafe-inline'", 'data:']
  // Allow any https image: user-authored skill markdown legitimately embeds
  // external images (badges, screenshots), and non-provider avatars render as
  // raw <img>. Images can't execute script, so a scheme source is the right
  // proportionate scope — CSP-for-XSS targets scripts, not images. (http is
  // still blocked; the optimizer output + inline images are 'self'/data:/blob:.)
  const imgSrc = ["'self'", 'data:', 'blob:', 'https:']
  // Browser talks to the same-origin BFF proxy, plus GitHub's read-only API/raw
  // hosts for the client-side "import from GitHub" discovery (a scoped exception
  // to same-origin — reputable, read-only). Dev also needs the HMR websocket.
  const connectSrc = [
    "'self'",
    'https://api.github.com',
    'https://raw.githubusercontent.com',
    ...(isDev ? ['ws:', 'wss:'] : []),
  ]

  const directives: string[] = [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(' ')}`,
    `style-src ${styleSrc.join(' ')}`,
    `img-src ${imgSrc.join(' ')}`,
    `font-src 'self'`,
    `connect-src ${connectSrc.join(' ')}`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
  ]
  // Only in production — in dev it would try to upgrade loopback http/ws to TLS
  // that isn't listening, breaking the registry call + HMR.
  if (!isDev) directives.push('upgrade-insecure-requests')

  return directives.join('; ')
}

export interface SecurityHeader {
  key: string
  value: string
}

/**
 * The full header list to attach. CSP header name depends on mode
 * (`off` omits CSP entirely); companion headers are always present.
 */
export function buildSecurityHeaders({
  mode,
  isDev,
}: {
  mode: CspMode
  isDev: boolean
}): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
  ]
  if (mode !== 'off') {
    const key =
      mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'
    headers.push({ key, value: buildCspValue({ isDev }) })
  }
  return headers
}
