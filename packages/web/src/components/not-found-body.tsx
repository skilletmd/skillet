import { Button } from '@/components/ui/button'

/**
 * The branded not-found body, shared by the global `app/not-found.tsx` boundary
 * and by routes that must render it directly.
 *
 * A route renders this instead of calling `notFound()` when its miss is
 * discovered after streaming has begun. Under `cacheComponents` the PPR shell
 * is flushed before an async page body runs, so a late `notFound()` throw swaps
 * to the boundary too late to reach the reader and the response arrives empty.
 * Rendering the body directly is deterministic regardless of flush timing. It
 * does not restore the 404 status — that is already on the wire — so pair it
 * with `robots: { index: false }` from the route's `generateMetadata`.
 */
export function NotFoundBody() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-[1120px] flex-col items-start justify-center px-[clamp(16px,4vw,32px)] py-16">
      <p className="font-mono text-sm tracking-[0.01em] text-(--accent)">404</p>
      <h1 className="mt-2 text-title font-semibold leading-[1.1]">
        We couldn&apos;t find that page
      </h1>
      <p className="mt-4 max-w-[56ch] text-base leading-[1.6] text-(--ink-2)">
        The skill or author you&apos;re looking for may have been unpublished, renamed, or never
        existed. Browse the directory to find what you need.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button href="/skills" variant="primary" size="md">
          Browse skills
        </Button>
        <Button href="/" variant="secondary" size="md">
          Back home
        </Button>
      </div>
    </main>
  )
}
