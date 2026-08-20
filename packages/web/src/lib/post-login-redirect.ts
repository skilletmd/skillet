import { optionalSafeCallbackPath } from '@/lib/auth-errors'
import { isHandleGatedPath } from '@/lib/activity-gate'

export interface PostLoginRedirectInput {
  /** Raw `callbackUrl` query param when the user had an explicit destination. */
  callbackUrl?: string | null
  /**
   * Whether the just-signed-in account has claimed a username. Only matters when
   * the destination is a handle-gated surface (e.g. /notifications): a `false`
   * there diverts to /settings to claim one instead of chasing a page the
   * account can't render. For every other destination it has no effect —
   * handle-less users belong in the app (Feed), not gated behind /settings.
   * Leave `undefined` when the handle is unknown; the callback is honored and
   * the proxy gate remains the backstop.
   */
  hasHandle?: boolean
}

/** Where to send the user after a successful web sign-in (OAuth or login code). */
export function resolvePostLoginPath(input: PostLoginRedirectInput): string {
  const raw = input.callbackUrl?.trim()
  const safeCallback = optionalSafeCallbackPath(raw)

  // Known handle-less AND headed for a handle-gated surface: claim a username
  // first. Resolving it here skips the empty-shell hop the proxy would otherwise
  // 307 through. Every other destination (and no destination) is left alone.
  if (input.hasHandle === false && safeCallback && isHandleGatedPath(safeCallback)) {
    return '/settings'
  }

  if (safeCallback) return safeCallback

  // Land everyone in the app (Feed is the logged-in home). Device setup isn't a
  // gate: the nav's Finish-setup pill carries /welcome until a device connects.
  return '/feed'
}
