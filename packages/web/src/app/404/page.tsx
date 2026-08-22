import type { Metadata } from 'next'
import { NotFoundBody } from '@/components/not-found-body'

/**
 * The branded 404 body at a fixed, always-routable URL.
 *
 * `proxy.ts` fetches this page once per window and re-sends its HTML under a
 * real 404 status (see `lib/agent-surface.ts` for why the status cannot come
 * from the render itself). Keeping it a normal page under the root layout means
 * the 404 an agent gets is byte-for-byte the 404 a person gets — chrome,
 * stylesheet, and copy all from the same source as `app/not-found.tsx`.
 *
 * It answers 200 on its own, which is correct: `/404` is a real page that
 * exists. It is `noindex` so the copy never competes with a real result, and it
 * is absent from the sitemap.
 */
export const metadata: Metadata = {
  title: "We couldn't find that page · Skillet",
  robots: { index: false, follow: false },
}

export default function NotFoundPage() {
  return <NotFoundBody />
}
