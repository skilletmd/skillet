import { NextResponse, type NextRequest } from 'next/server'
import {
  appendVaryAccept,
  isNotAcceptable,
  isSingleRepresentationPath,
  MARKDOWN_CONTENT_TYPE,
  NOT_ACCEPTABLE_BODY,
  wantsMarkdown,
} from './content-negotiation'
import { classifyRoute, hasMarkdownVariant, type RegistryLookup } from './agent-routes'
import { REGISTRY_API } from './registry-prefix'
import { registryFetchOriginOrDefault } from './registry-origin'
import { siteUrl } from './site-url'

/**
 * The agent-facing half of `proxy.ts`: real 404s, and Markdown for clients that
 * ask for it.
 *
 * Both have to happen before rendering. Under `cacheComponents` the PPR shell
 * flushes with a `200` before a page body can call `notFound()`, and a Server
 * Component cannot choose its own content type — so the decision belongs here
 * or nowhere. See `agent-routes.ts` for why the route table is hand-held.
 *
 * Runs on the Node.js runtime (Next always runs `proxy.ts` there), so
 * `process.env.REGISTRY_URL` and loopback `fetch` are both available.
 */

/** Rendering the branded 404 body is a self-request; this marks it so the
 *  request cannot re-enter the 404 path. */
const NOT_FOUND_RENDER_PATH = '/404'

/** Registry lookups are cached in-process: a bot sweeping a handle namespace
 *  must not turn into one registry read per probe. */
const EXISTS_TTL_MS = 60_000
const MISSING_TTL_MS = 30_000
const LOOKUP_TIMEOUT_MS = 1_500

type Existence = 'exists' | 'missing'
const existenceCache = new Map<string, { value: Existence; expiresAt: number }>()

/** Cached HTML of the branded 404 page, refetched at most once per window. */
const NOT_FOUND_HTML_TTL_MS = 600_000
let notFoundHtml: { html: string; expiresAt: number } | null = null

function lookupPath(check: RegistryLookup): string {
  switch (check.type) {
    case 'author':
      return `/profiles/${check.author}`
    case 'skill':
      return `/skills/${check.author}/${check.slug}`
    case 'kit':
      return `/kits/by-handle/${check.owner}/${check.slug}`
  }
}

/**
 * Does the registry know this resource?
 *
 * Anonymous by design: no session token is forwarded, so this only ever
 * answers about public data. `proxy.ts` only asks for requests with no session,
 * which is what keeps a private skill from 404ing for the person who owns it.
 *
 * FAILS OPEN. `null` means "could not tell" — a timeout, a 5xx, an unreachable
 * registry — and the caller renders the page as it would have anyway. Only an
 * explicit 404 from the registry produces a 404 here. A registry hiccup must
 * never turn the whole catalog into dead links.
 */
export async function registryResourceExists(check: RegistryLookup): Promise<boolean | null> {
  const path = lookupPath(check)
  const now = Date.now()
  const hit = existenceCache.get(path)
  if (hit && hit.expiresAt > now) return hit.value === 'exists'

  let status: number
  try {
    const res = await fetch(`${registryFetchOriginOrDefault()}${REGISTRY_API}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
    status = res.status
    // Drain so the socket is released rather than held to the response timeout.
    await res.arrayBuffer().catch(() => undefined)
  } catch {
    return null
  }

  // 410 is a deprecated skill: the page renders a tombstone, not a 404.
  if (status === 404) {
    existenceCache.set(path, { value: 'missing', expiresAt: now + MISSING_TTL_MS })
    return false
  }
  if (status >= 200 && status < 400) {
    existenceCache.set(path, { value: 'exists', expiresAt: now + EXISTS_TTL_MS })
    return true
  }
  return null
}

/** Test seam: drop memoized existence and 404-page state. */
export function resetAgentSurfaceCaches(): void {
  existenceCache.clear()
  notFoundHtml = null
}

/**
 * This worker's own reachable origin, for the `/404` self-request.
 *
 * `req.nextUrl.origin` is the PUBLIC origin, so fetching it in production
 * hairpins out through the CDN and back. Prefer loopback on the port this
 * process is listening on (PM2 sets `PORT` per worker); `SKILLET_WEB_SELF_ORIGIN`
 * overrides for topologies where that is wrong, and the request origin is the
 * last resort.
 */
function selfOrigin(requestOrigin: string): string {
  const configured = process.env.SKILLET_WEB_SELF_ORIGIN?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  const port = process.env.PORT?.trim()
  if (port && /^\d+$/.test(port)) return `http://127.0.0.1:${port}`
  return requestOrigin
}

/**
 * The Markdown body of a 404, with the pointers an agent needs next.
 *
 * Links are built from the canonical site origin, not the request's: an agent
 * that reached a worker through some other hostname still gets URLs it can
 * hand to a user or fetch again later.
 */
export function notFoundMarkdownBody(pathname: string): string {
  const abs = (p: string) => new URL(p, `${siteUrl()}/`).toString()
  return [
    '# 404 Not Found',
    '',
    `No resource exists at \`${pathname}\`.`,
    '',
    '## Where to look instead',
    '',
    `- Site map for agents: ${abs('/llms.txt')}`,
    `- Full URL index: ${abs('/sitemap.xml')}`,
    `- Documentation: ${abs('/docs')}`,
    `- API description: ${abs('/openapi.json')}`,
    '',
  ].join('\n')
}

/**
 * The branded 404 page's HTML, fetched once per window from `/404` and reused.
 *
 * Why a self-request rather than a rewrite: a rewritten response takes the
 * destination's status, and every document route in this app answers 200 (the
 * PPR shell is already on the wire). Fetching the rendered page and re-sending
 * it under a 404 keeps the exact layout, chrome, and stylesheet the branded 404
 * has today, which no hand-written fallback document would.
 *
 * `/404` is a static top-level route, so `proxy.ts` classifies it as `known`
 * and this can never recurse.
 */
async function brandedNotFoundHtml(requestOrigin: string): Promise<string | null> {
  const now = Date.now()
  if (notFoundHtml && notFoundHtml.expiresAt > now) return notFoundHtml.html
  try {
    const res = await fetch(new URL(NOT_FOUND_RENDER_PATH, selfOrigin(requestOrigin)), {
      headers: { accept: 'text/html' },
      cache: 'no-store',
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
    // Next reserves `/404` as its not-found route and answers it with a 404
    // status, so `res.ok` is false for a perfectly good render. Take either.
    if (res.status !== 200 && res.status !== 404) return null
    const html = await res.text()
    if (!html.trim()) return null
    notFoundHtml = { html, expiresAt: now + NOT_FOUND_HTML_TTL_MS }
    return html
  } catch {
    return null
  }
}

/** Minimal standalone 404 for when even `/404` cannot be rendered. */
function fallbackNotFoundHtml(pathname: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>404 · Skillet</title><meta name="robots" content="noindex"></head><body><h1>404: we couldn't find that page</h1><p>Nothing exists at <code>${pathname.replace(/[<&]/g, '')}</code>.</p><p><a href="/browse">Browse skills</a> · <a href="/docs">Docs</a> · <a href="/llms.txt">llms.txt</a></p></body></html>`
}

/** A real 404, in the representation the caller asked for. */
export async function notFoundResponse(
  pathname: string,
  accept: string | null,
  origin: string,
): Promise<NextResponse> {
  const headers = new Headers({
    vary: 'Accept, Accept-Encoding',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
  })

  const acceptsHtml = !wantsMarkdown(accept) && (accept ?? '').includes('text/html')
  if (acceptsHtml) {
    const html = (await brandedNotFoundHtml(origin)) ?? fallbackNotFoundHtml(pathname)
    headers.set('content-type', 'text/html; charset=utf-8')
    return new NextResponse(html, { status: 404, headers })
  }

  headers.set('content-type', MARKDOWN_CONTENT_TYPE)
  return new NextResponse(notFoundMarkdownBody(pathname), { status: 404, headers })
}

/** RFC 9110 §15.5.7 — the client accepts nothing this origin produces. */
export function notAcceptableResponse(): NextResponse {
  return new NextResponse(NOT_ACCEPTABLE_BODY, {
    status: 406,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      vary: 'Accept, Accept-Encoding',
    },
  })
}

/** Rewrite target that serves `pathname` as Markdown. */
export function markdownRewriteUrl(req: NextRequest, pathname: string): URL {
  const url = req.nextUrl.clone()
  url.pathname = `/api/md${pathname === '/' ? '' : pathname}`
  return url
}

/**
 * Decide what an agent-shaped request gets, or `null` to render normally.
 *
 * Order matters: an explicit `.md` URL wins over `Accept` (a crawler following
 * a `rel="alternate"` link may send no Accept at all), then 406, then the 404
 * decision, and only then Markdown negotiation — a Markdown request for a page
 * that does not exist should 404, not render an empty document.
 */
export async function agentSurfaceResponse(
  req: NextRequest & { auth?: unknown },
): Promise<NextResponse | null> {
  // Only real document reads negotiate. Next's own transport — RSC payload
  // fetches, prefetches, and Server Actions — sends `Accept: text/x-component`,
  // which no representation here satisfies; treating that as a content
  // negotiation failure would 406 every client-side navigation in the app.
  // Leaving them alone also keeps a soft navigation to a missing page rendering
  // the in-app 404 boundary instead of forcing a full page load.
  if (req.method !== 'GET' && req.method !== 'HEAD') return null
  if (
    req.headers.has('rsc') ||
    req.headers.has('next-action') ||
    req.headers.has('next-router-prefetch')
  ) {
    return null
  }

  const pathname = req.nextUrl.pathname
  const accept = req.headers.get('accept')

  // `/docs/install.md` — the llms.txt convention for addressing the Markdown
  // variant directly. Unconditional: no Accept header required.
  if (pathname.endsWith('.md') && pathname.length > 3) {
    const base = pathname.slice(0, -3)
    if (hasMarkdownVariant(base)) {
      const res = NextResponse.rewrite(markdownRewriteUrl(req, base))
      appendVaryAccept(res.headers)
      return res
    }
  }

  // Single-representation endpoints never negotiate. See
  // isSingleRepresentationPath — this guard is what keeps the desktop updater's
  // `Accept: application/json` from 406ing before its route can answer.
  if (isSingleRepresentationPath(pathname)) return null

  if (isNotAcceptable(accept)) return notAcceptableResponse()

  // Existence is only decidable for a caller with no session: a signed-in
  // viewer may own private skills and unlisted kits that an anonymous lookup
  // cannot see, and 404ing someone's own page would be worse than a soft 404.
  if (!req.auth) {
    const verdict = classifyRoute(pathname)
    if (verdict.kind === 'unknown') {
      return notFoundResponse(pathname, accept, req.nextUrl.origin)
    }
    if (verdict.kind === 'registry') {
      const exists = await registryResourceExists(verdict.check)
      if (exists === false) return notFoundResponse(pathname, accept, req.nextUrl.origin)
    }
  }

  if (wantsMarkdown(accept) && hasMarkdownVariant(pathname)) {
    const res = NextResponse.rewrite(markdownRewriteUrl(req, pathname))
    appendVaryAccept(res.headers)
    return res
  }

  return null
}
