'use client'

import { useEffect } from 'react'

/**
 * Reset scroll to the top when landing on the feed.
 *
 * The feed renders its header + skeleton synchronously and streams the body via
 * an inner <Suspense> (the PPR/streaming pattern), so it never suspends at the
 * segment boundary. Next's App Router scroll handler then sees the new content
 * as "already in view" and skips its reset — carrying over the scroll offset
 * from the previous page (e.g. "See all" from a home shelf landed you halfway
 * down). Mounting once on entry forces the top. Soft lens-tab switches keep this
 * mounted, so they don't yank the page around.
 */
export function ScrollTopOnEnter() {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])
  return null
}
