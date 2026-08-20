import Link from 'next/link'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

// The untrusted-markdown link guard is hoisted into shared protocol (the covers
// pattern) so web and desktop share one implementation. Re-exported here so
// existing consumers keep importing it from '@/components/app-link'.
export { isSafeUntrustedHref } from '@skillet/protocol/untrusted-href'

/** Same-origin routes and in-page hash targets use Next.js client navigation. */
export function isInternalHref(href: string): boolean {
  return href.startsWith('/') || href.startsWith('#')
}

/**
 * Route handlers (`/api/*`) are not page routes: they set cookies, redirect, or
 * stream downloads. They must be a plain hard navigation, never a prefetched
 * Next <Link> (prefetch would execute the side-effecting GET before the click,
 * e.g. firing an OAuth start). Same-origin, same tab — no target=_blank.
 */
export function isApiHref(href: string): boolean {
  return href.startsWith('/api/')
}

export function AppLink({
  href,
  children,
  className,
  ...rest
}: {
  href: string
  children: ReactNode
  className?: string
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  if (isApiHref(href)) {
    return (
      <a href={href} className={className} {...rest}>
        {children}
      </a>
    )
  }
  if (isInternalHref(href)) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  )
}
