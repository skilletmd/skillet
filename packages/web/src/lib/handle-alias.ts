// `/@handle` and `/@handle/skill` are aliases for the canonical `/handle` and
// `/handle/skill` pages. Every handle-based product has taught people that an
// @-prefixed URL is a person, and the summon flow (`/skillet @mattpocock`) teaches
// it again, so the @ form is what people type and what agent output can link to.
//
// It redirects rather than rewrites: one canonical URL per page, so the alias
// costs nothing in duplicate content. 308 (not the NextResponse default 307) so
// the mapping is cacheable and permanent.

/** Match `/@handle`, `/@handle/anything`, and the percent-encoded `%40` form. */
const HANDLE_ALIAS = /^\/(?:@|%40)([^/]+)(\/.*)?$/i

/**
 * The canonical path for an @-prefixed URL, or null when the path isn't one.
 * A bare `/@` has no handle and is left alone (it falls through to not-found).
 */
export function handleAliasTarget(pathname: string): string | null {
  const m = HANDLE_ALIAS.exec(pathname)
  if (!m) return null
  const handle = m[1]
  // `/@` and `/@/skill` carry no handle to redirect to.
  if (!handle) return null
  return `/${handle}${m[2] ?? ''}`
}
