'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Reset scroll to the top when landing on a document page.
 *
 * These pages render a shell synchronously and stream the body via an inner
 * <Suspense> (the PPR pattern), so they never suspend at the segment boundary.
 * Next's App Router scroll handler then sees the new content as "already in
 * view" and skips its reset, carrying the previous page's scroll offset over:
 * click a card near the bottom of /browse/people and the profile opens with its
 * name already scrolled under the header.
 *
 * Keyed on pathname, not just mount. `/a` and `/b` are the same route with a
 * different param, so React keeps this mounted across them and a mount-only
 * effect would fire once and never again.
 *
 * `(activity)/feed` keeps its own mount-only copy on purpose: soft lens-tab
 * switches there must NOT yank the page, which is the opposite requirement.
 */
export function ScrollTopOnEnter() {
  const pathname = usePathname()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}
