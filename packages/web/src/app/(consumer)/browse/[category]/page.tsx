import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isCategoryKey, isSectionSlug } from '@/lib/categories'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import {
  BrowseGrid,
  browseMetadata,
  parseBrowseQuery,
  type BrowseSearchParams,
} from '../browse-view'
import { parseBrowseView } from '../../skills/explore-surface'

// A single segment after /browse is either a TYPE (skills/kits/people — all
// categories) or a CATEGORY (all types). The category+type combination lives one
// level deeper at /browse/<category>/<type>.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const { category: segment } = await params
  // Type segments share the generic Browse metadata; categories and sections
  // get their own (browseMetadata falls back to generic for a type segment).
  return browseMetadata(segment)
}

async function BrowseSegmentContent({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>
  searchParams: Promise<BrowseSearchParams>
}) {
  const { category: segment } = await params
  const sp = await searchParams
  const { q, offset, sort } = parseBrowseQuery(sp)

  // Type segment (skills/kits/people): all categories of that type.
  const asType = parseBrowseView(segment)
  if (asType !== 'all') {
    return <BrowseGrid view={asType} category="" q={q} offset={offset} sort={sort} />
  }

  // Otherwise it must be a single category or a section (all types). A section
  // slug threads through as the category; it expands to its keys at the registry
  // boundary.
  if (!isCategoryKey(segment) && !isSectionSlug(segment)) notFound()
  return <BrowseGrid view="all" category={segment} q={q} offset={offset} sort={sort} />
}

export default function BrowseSegmentPage(props: {
  params: Promise<{ category: string }>
  searchParams: Promise<BrowseSearchParams>
}) {
  return (
    <DynamicPageBoundary>
      <BrowseSegmentContent {...props} />
    </DynamicPageBoundary>
  )
}
