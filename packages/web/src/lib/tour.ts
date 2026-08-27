/**
 * The tour: three marketing pages, one benefit each.
 *
 * Kept as data rather than three hand-linked pages because four surfaces need
 * the same list and must not drift: the `/tour` index, the next/prev rail at
 * the foot of each stop, `sitemap.ts`, and `classifyRoute` in
 * `lib/agent-routes.ts` (which decides the 404 for an unknown slug before the
 * page renders, so it cannot ask the filesystem what stops exist).
 *
 * Node-free on purpose. `proxy.ts` imports the slug set through
 * `agent-routes.ts`, and anything reaching for `node:*` there blank-pages the
 * edge path.
 */

export type TourSlug = 'discovery' | 'skills' | 'routing'

export type TourStop = {
  slug: TourSlug
  /** The stop's name in the index, the next-steps rail, and the page H1. */
  name: string
  /** One line for the index card and the `<meta name="description">`. */
  blurb: string
}

export const TOUR_STOPS: readonly TourStop[] = [
  {
    slug: 'discovery',
    name: 'Finding skills worth running',
    blurb:
      'Skillet ranks skills by the people you follow, not by install count, and scans every version before serving it.',
  },
  {
    slug: 'skills',
    name: 'One copy, every agent',
    blurb:
      'One copy of each skill in ~/.skillet, written into every runtime you connect. Nothing changes until you approve it.',
  },
  {
    slug: 'routing',
    name: 'Routing',
    blurb:
      '/skillet <task> reads your kit, picks the one skill that fits, and loads it. Only that skill enters the context.',
  },
]

export const TOUR_SLUGS: ReadonlySet<string> = new Set(TOUR_STOPS.map((s) => s.slug))

export function tourHref(slug: TourSlug): string {
  return `/tour/${slug}`
}

export function findTourStop(slug: string): TourStop | undefined {
  return TOUR_STOPS.find((s) => s.slug === slug)
}

/** The stop after this one, wrapping at the end so next steps always has a target. */
export function nextTourStop(slug: TourSlug): TourStop {
  const i = TOUR_STOPS.findIndex((s) => s.slug === slug)
  return TOUR_STOPS[(i + 1) % TOUR_STOPS.length]!
}
