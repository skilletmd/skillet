import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isCategoryKey, isSectionSlug } from '@/lib/categories'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import {
  BrowseGrid,
  browseMetadata,
  parseBrowseQuery,
  type BrowseSearchParams,
} from '../../browse-view'
import { parseBrowseView } from '../../../skills/explore-surface'

// /browse/<category>/<type> — a type filter nested inside a category, e.g.
// /browse/frontend/people. The category owns the leading segment.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; type: string }>
}): Promise<Metadata> {
  const { category } = await params
  return browseMetadata(category)
}

async function BrowseCategoryTypeContent({
  params,
  searchParams,
}: {
  params: Promise<{ category: string; type: string }>
  searchParams: Promise<BrowseSearchParams>
}) {
  const { category, type } = await params
  const view = parseBrowseView(type)
  // The first segment must be a real category or section, the second a real type.
  if ((!isCategoryKey(category) && !isSectionSlug(category)) || view === 'all') notFound()
  const sp = await searchParams
  const { q, offset, sort } = parseBrowseQuery(sp)
  return <BrowseGrid view={view} category={category} q={q} offset={offset} sort={sort} />
}

export default function BrowseCategoryTypePage(props: {
  params: Promise<{ category: string; type: string }>
  searchParams: Promise<BrowseSearchParams>
}) {
  return (
    <DynamicPageBoundary>
      <BrowseCategoryTypeContent {...props} />
    </DynamicPageBoundary>
  )
}
