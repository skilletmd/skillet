'use client'

import { useEffect, useRef } from 'react'

/**
 * Run `handler` when the page is restored from the browser's back/forward
 * cache. A bfcache restore resurrects client state exactly as it was left —
 * including in-flight busy flags whose fetch/navigation died with the page, and
 * local form state that no longer matches what the server has. Use this to
 * reset whatever a restore would misrepresent.
 */
export function useBfcacheRestore(handler: () => void): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) ref.current()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])
}
