import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { activityGateTarget } from '@/lib/activity-gate'
import { adminProxyGate } from '@/lib/admin'
import { isBrowsePathname } from '@/lib/browse-pathname'
import {
  BROWSE_SSR_RID_HEADER,
  isBrowseSsrProbeEnabled,
  newBrowseSsrRequestId,
} from '@/lib/browse-ssr-probe'
import { handleAliasTarget } from '@/lib/handle-alias'
import { agentSurfaceResponse } from '@/lib/agent-surface'
import { isLabPath } from '@/lib/lab-gate'
import { appendVaryAccept } from '@/lib/content-negotiation'
import { buildSecurityHeaders, resolveCspMode } from '@/lib/security-headers'

let warnedNonEnforcing = false

/** Attach the static CSP + companion security headers (defense-in-depth). */
function withSecurityHeaders(res: NextResponse): NextResponse {
  const isDev = process.env.NODE_ENV !== 'production'
  const mode = resolveCspMode(process.env.WEB_CSP_MODE)

  // Surface a silent prod downgrade: report-only/off do not enforce anything.
  if (!isDev && mode !== 'enforce' && !warnedNonEnforcing) {
    warnedNonEnforcing = true
    console.warn(
      `[security-headers] CSP is "${mode}" in production (non-enforcing). ` +
        'Set WEB_CSP_MODE=enforce to enforce the policy.',
    )
  }

  for (const { key, value } of buildSecurityHeaders({ mode, isDev })) {
    res.headers.set(key, value)
  }
  return res
}

/** Document fall-through: forward pathname (+ probe rid) into the RSC tree. */
function nextWithPathname(req: {
  headers: Headers
  nextUrl: { pathname: string }
  auth?: unknown
}): NextResponse {
  const requestHeaders = new Headers(req.headers)
  const pathname = req.nextUrl.pathname
  requestHeaders.set('x-pathname', pathname)

  // Correlate [browse-ssr] lines across proxy → layout → page when the probe
  // flag is on. Cheap header write; logs only fire for Browse paths.
  if (isBrowseSsrProbeEnabled()) {
    const rid = requestHeaders.get(BROWSE_SSR_RID_HEADER) ?? newBrowseSsrRequestId()
    requestHeaders.set(BROWSE_SSR_RID_HEADER, rid)
    if (isBrowsePathname(pathname)) {
      console.info('[browse-ssr]', 'proxy_enter', {
        rid,
        pathname,
        authed: Boolean(req.auth),
      })
    }
  }

  const res = withSecurityHeaders(
    NextResponse.next({
      request: { headers: requestHeaders },
    }),
  )
  // This URL has (or may have) a Markdown twin at the same address, so a shared
  // cache must key on Accept. Appended, never assigned: Next's own RSC routing
  // tokens already live on Vary and clobbering them breaks client navigation.
  appendVaryAccept(res.headers)

  // /lab is internal tooling: reachable on purpose, but nothing should send
  // anyone there. It is absent from the sitemap and llms.txt, disallowed in
  // robots.txt, and its pages carry a noindex meta. The header is the belt to
  // that braces — it reaches a crawler that ignores robots.txt, and it covers
  // any response under /lab that is not an HTML document.
  if (isLabPath(pathname)) res.headers.set('x-robots-tag', 'noindex, nofollow')

  return res
}

export default auth(async (req) => {
  const { pathname, searchParams } = req.nextUrl

  // Every branch wraps its response with the static security headers. A static
  // header here does NOT force dynamic rendering (no nonce), so static/CDN
  // caching + cacheComponents are preserved; the mode is read from the env at
  // runtime, so WEB_CSP_MODE=off is an instant rollback.

  // Auth-aware root: signed-in users go to their Feed; logged-out visitors and
  // crawlers fall through to the marketing landing at /. Done here (before render)
  // because redirecting from the PPR root page after its shell starts streaming
  // throws a React "boundaries flushed again" error.
  if (pathname === '/' && req.auth) {
    const url = req.nextUrl.clone()
    url.pathname = '/feed'
    url.search = ''
    return withSecurityHeaders(NextResponse.redirect(url))
  }

  // Paste a full GitHub URL after the host (e.g.
  // /https://github.com/owner/repo) and land in the importer. The bare
  // /github.com/owner/repo form is handled by a route instead.
  const ghUrl = pathname.match(/^\/https?:\/+github\.com\/(.+)/i)
  if (ghUrl) {
    const url = req.nextUrl.clone()
    url.pathname = '/import'
    url.search = ''
    url.searchParams.set('url', `github.com/${ghUrl[1]}`)
    return withSecurityHeaders(NextResponse.redirect(url))
  }

  // `/@handle` and `/@handle/skill` alias the canonical `/handle` pages. 308 so
  // the mapping is permanent and cacheable, and so there stays exactly one
  // indexable URL per page.
  const aliasTarget = handleAliasTarget(pathname)
  if (aliasTarget) {
    const url = req.nextUrl.clone()
    url.pathname = aliasTarget
    return withSecurityHeaders(NextResponse.redirect(url, 308))
  }

  // Legacy path redirect. The directory lives on /browse now; map the old
  // /skills path (with its `tab` param) onto the browse `type` chip before the
  // route renders, which avoids a loading skeleton flash.
  if (pathname === '/skills') {
    const url = req.nextUrl.clone()
    url.pathname = '/browse'
    const tab = searchParams.get('tab')
    url.searchParams.delete('tab')
    url.searchParams.set('type', tab === 'kits' || tab === 'people' ? tab : 'skills')
    return withSecurityHeaders(NextResponse.redirect(url))
  }

  // Auth-gate settings.
  if (pathname.startsWith('/settings') && !req.auth) {
    const login = new URL('/login', req.nextUrl.origin)
    login.searchParams.set('callbackUrl', pathname)
    return withSecurityHeaders(NextResponse.redirect(login))
  }

  // Handle-gate the activity surfaces (/notifications, /updates). Their pages
  // call requireHandle, but that redirect fires after the (activity) shell has
  // flushed and degrades to a streamed client redirect that strands handle-less
  // users on an empty shell. Deciding here — where req.auth.handle already
  // reflects the session self-heal — issues a clean 307 before any render.
  const activityTarget = activityGateTarget(pathname, req.auth)
  if (activityTarget) {
    return withSecurityHeaders(NextResponse.redirect(new URL(activityTarget, req.nextUrl.origin)))
  }

  // Machine-facing surface, decided before any render: a real 404 for a path
  // nothing serves, Markdown for a client that asked for it, and 406 when the
  // client accepts neither representation. See lib/agent-surface.ts — none of
  // it can be decided during render, because the PPR shell (and its 200) is
  // already on the wire by then.
  //
  // Placed after the redirect rules so an alias still redirects rather than
  // 404ing, and before the admin gate so an admin path keeps its own handling.
  const agentResponse = await agentSurfaceResponse(req)
  if (agentResponse) return withSecurityHeaders(agentResponse)

  // Auth-gate /admin and /internal: signed in AND allowlisted admin principal
  // (SKILLET_ADMIN_HANDLES and/or SKILLET_ADMIN_USER_IDS). Server actions under
  // assertAdmin(); this is the page-route gate. Unset allowlist => no admins.
  const adminBlock = adminProxyGate(pathname, req.auth, req.nextUrl.origin)
  if (adminBlock) return withSecurityHeaders(adminBlock)

  return nextWithPathname(req)
})

export const config = {
  // Cover all document routes so the CSP reaches every page. Exclude Next's
  // static assets + image optimizer (no need to header those) and ALL /api
  // routes — API responses don't need a document CSP, and excluding them keeps
  // NextAuth's own /api/auth handlers and the BFF/OG routes untouched.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
