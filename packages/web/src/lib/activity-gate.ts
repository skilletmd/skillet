import { loginHref } from '@/lib/urls'

/**
 * The activity surfaces that can't render without a claimed username. Their
 * pages call `requireHandle`, but that gate runs *inside* a page whose parent
 * `(activity)` layout flushes its shell synchronously — so a `redirect()` thrown
 * there degrades from an HTTP 307 into a streamed client-side redirect that, for
 * the handle-less path, never completes and strands the user on an empty shell.
 * The proxy decides here instead, before anything renders.
 */
const HANDLE_GATED_PATHS = new Set(['/notifications', '/updates'])

/**
 * True when `pathname` is a surface that can't render without a claimed
 * username. Ignores any query/hash so a `callbackUrl` like `/notifications?x=1`
 * still matches. Shared by the proxy gate and the post-login resolver so both
 * agree on exactly which destinations require a handle.
 */
export function isHandleGatedPath(pathname: string): boolean {
  return HANDLE_GATED_PATHS.has(pathname.split(/[?#]/, 1)[0])
}

/**
 * True when a session has actually claimed a username (a non-blank handle). The
 * single source of truth for "has a handle" across the proxy gate, the
 * post-login resolver, and the verify route.
 */
export function hasClaimedHandle(handle: string | null | undefined): boolean {
  return typeof handle === 'string' && handle.trim().length > 0
}

/**
 * Where the proxy should send a request to a handle-gated activity surface, or
 * `null` to let it through. `session` is `req.auth` from the `auth()`-wrapped
 * proxy, so `handle` already reflects the session-callback self-heal (the
 * registry is the source of truth for a just-claimed username) — no extra
 * lookup needed here.
 *
 *   not gated path         -> null (through)
 *   logged out             -> /login?callbackUrl=<path>
 *   signed in, no handle   -> /settings (claim a username)
 *   signed in with handle  -> null (through)
 */
export function activityGateTarget(
  pathname: string,
  session: { handle?: string | null } | null | undefined,
): string | null {
  if (!isHandleGatedPath(pathname)) return null
  if (!session) return loginHref(pathname)
  if (!hasClaimedHandle(session.handle)) return '/settings'
  return null
}
