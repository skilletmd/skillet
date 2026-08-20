import { Suspense, type ReactNode } from 'react'

/** Keeps searchParams/auth/cookies inside Suspense under cacheComponents. */
export function DynamicPageBoundary({
  children,
  fallback = null,
}: {
  children: ReactNode
  fallback?: ReactNode
}) {
  return <Suspense fallback={fallback}>{children}</Suspense>
}
