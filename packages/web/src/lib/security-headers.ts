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

/**
 * The one page another origin may frame: `skillet map` serves a page on the
 * person's computer that frames this one and hands it the scan by postMessage.
 */
export const MAP_EMBED_PATH = '/map/embed'

/**
 * The three rules /map/embed swaps into the site policy. Framing from the
 * loopback page only, and no connection and no image that isn't inline, so
 * nothing about the person's skills can leave the frame before Save: no fetch,
 * no beacon, no avatar URL that would tell an image host which jobs are empty.
 * Dev keeps the HMR websocket, as the site policy does.
 */
function mapEmbedRules(isDev: boolean): [string, string][] {
  return [
    ['frame-ancestors', 'http://127.0.0.1:* http://localhost:*'],
    ['connect-src', isDev ? 'ws: wss:' : "'none'"],
    ['img-src', 'data: blob:'],
  ]
}

const joinRules = (rules: [string, string][]) => rules.map(([name, value]) => `${name} ${value}`).join('; ')

/**
 * Build the CSP value string for the given environment. `embed` is the
 * /map/embed variant: the same policy with {@link mapEmbedRules} in place of
 * its framing, connection and image rules.
 */
export function buildCspValue({ isDev, embed = false }: { isDev: boolean; embed?: boolean }): string {
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

  const site: [string, string][] = [
    ['default-src', "'self'"],
    ['script-src', scriptSrc.join(' ')],
    ['style-src', styleSrc.join(' ')],
    ['img-src', imgSrc.join(' ')],
    ['font-src', "'self'"],
    ['connect-src', connectSrc.join(' ')],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
    ['frame-src', "'none'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
  ]
  const swapped = embed ? new Map(mapEmbedRules(isDev)) : null
  const directives = [joinRules(site.map(([name, value]): [string, string] => [name, swapped?.get(name) ?? value]))]
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
 *
 * Route-aware for exactly one path: /map/embed carries the embed variant of the
 * site policy and no `X-Frame-Options`, so the loopback page can frame it. A
 * second header could not loosen the site policy (browsers apply every enforced
 * policy), which is why the variant replaces it rather than adding to it. And
 * because report-only and off enforce nothing, the embed then also gets its
 * three rules as an enforced header of their own: the framing rule and the
 * privacy boundary hold in every mode, the rollback switch included.
 */
export function buildSecurityHeaders({
  mode,
  isDev,
  pathname,
}: {
  mode: CspMode
  isDev: boolean
  /** The request path. Only {@link MAP_EMBED_PATH} changes anything. */
  pathname?: string
}): SecurityHeader[] {
  const embed = pathname === MAP_EMBED_PATH
  const headers: SecurityHeader[] = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  ]
  if (!embed) headers.push({ key: 'X-Frame-Options', value: 'DENY' })
  if (mode !== 'off') {
    const key =
      mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'
    headers.push({ key, value: buildCspValue({ isDev, embed }) })
  }
  if (embed && mode !== 'enforce') {
    headers.push({ key: 'Content-Security-Policy', value: joinRules(mapEmbedRules(isDev)) })
  }
  return headers
}
