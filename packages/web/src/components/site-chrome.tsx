'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { SiteNav } from '@/components/site-nav'

// Routes that own their full chrome (custom nav + footer) and must not render
// the shared SiteNav/SiteFooter.
const BARE_PREFIXES: string[] = []

// `footer` is rendered on the server and passed in as a slot: SiteFooter pulls in
// the async GithubStarBadge (a server component), which can't live in this client
// module's bundle.
export function SiteChrome({
  children,
  footer,
}: {
  children: React.ReactNode
  footer: React.ReactNode
}) {
  const pathname = usePathname() ?? ''
  const bare = BARE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  // Reset scroll to the top on forward navigation. The window is the scroller
  // (.site-shell is min-height:100vh, not a fixed-height overflow container), and
  // a client push was leaving the new page at the previous scroll offset. Skip
  // back/forward (popstate) so the browser's own scroll restoration still works.
  const poppedRef = useRef(false)
  useEffect(() => {
    const onPop = () => {
      poppedRef.current = true
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    if (poppedRef.current) {
      poppedRef.current = false
      return
    }
    window.scrollTo(0, 0)
  }, [pathname])

  if (bare) return <>{children}</>

  return (
    <div className="site-shell">
      {/* /home is the same marketing page as /, reached by signed-in viewers
          (middleware redirects / to /feed for them), so it gets the same
          transparent-at-top header. Leaving it out gave that page a permanent
          bottom border while / had none. */}
      <SiteNav
        transparentAtTop={pathname === '/' || pathname === '/home' || pathname === '/install'}
      />
      <div className="site-shell-content">{children}</div>
      {footer}
    </div>
  )
}
