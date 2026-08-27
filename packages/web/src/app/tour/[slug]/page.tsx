import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { findTourStop, TOUR_STOPS, tourHref, type TourSlug } from '@/lib/tour'
import { DiscoveryStop } from '../_components/discovery'
import { SkillsStop } from '../_components/skills'
import { RoutingStop } from '../_components/routing'

/**
 * One tour stop, one benefit. Three static pages behind a dynamic segment, so
 * `generateStaticParams` prerenders the whole set and nothing hits a datastore.
 *
 * An unknown slug is already a real 404 before this renders: `classifyRoute`
 * enumerates `TOUR_SLUGS` and `proxy.ts` answers on the wire. The `notFound()`
 * below is the belt to that braces (a direct render bypassing proxy), not the
 * mechanism, because under `cacheComponents` the PPR shell has flushed its 200
 * long before this function body runs.
 *
 * `dynamicParams = false` would be the usual way to close the set, and it is
 * exactly what `cacheComponents` rejects at compile time ("not compatible with
 * nextConfig.cacheComponents"). Closing the set is proxy.ts's job here anyway,
 * which is the same reason `/browse` and `/news` enumerate their segments there.
 */

const BODIES: Record<TourSlug, () => React.ReactElement> = {
  discovery: DiscoveryStop,
  skills: SkillsStop,
  routing: RoutingStop,
}

export function generateStaticParams(): { slug: string }[] {
  return TOUR_STOPS.map((stop) => ({ slug: stop.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const stop = findTourStop(slug)
  if (!stop) return {}
  return {
    title: `${stop.name} · Skillet`,
    description: stop.blurb,
    alternates: { canonical: tourHref(stop.slug) },
  }
}

export default async function TourStopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const stop = findTourStop(slug)
  if (!stop) notFound()
  const Body = BODIES[stop.slug]
  return (
    <main>
      <Body />
    </main>
  )
}
