'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useSession } from 'next-auth/react'

/**
 * The mascot is a way back to the landing page.
 *
 * Signed out that is `/`. Signed in it has to be `/home`, because middleware
 * redirects `/` to the feed for a signed-in viewer, so linking `/` would send
 * them somewhere other than where the mark points. `/home` renders the same
 * page `/` does.
 *
 * Session comes from the client provider the root layout already mounts;
 * reading the cookie here would make the layout dynamic on every route. While
 * it resolves, `/` is the honest default.
 */
export function FooterMascot() {
  const { status } = useSession()
  const href = status === 'authenticated' ? '/home' : '/'
  return (
    <Link href={href} aria-label="Skillet home" className="inline-flex shrink-0">
      <Image
        src="/brand/skillet-cooking.png"
        alt="Skillet"
        width={480}
        height={389}
        // -my-2 lets the mark overflow into the footer padding instead of
        // growing the row, so it stays visible without a taller footer.
        className="footer-mascot -my-2 h-9 w-auto"
        priority={false}
      />
    </Link>
  )
}
