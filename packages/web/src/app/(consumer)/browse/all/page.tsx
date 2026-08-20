import type { Metadata } from 'next'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import {
  BrowseGrid,
  browseMetadata,
  parseBrowseQuery,
  type BrowseSearchParams,
} from '../browse-view'

export const metadata: Metadata = browseMetadata('')

// /browse/all — the full All Skills grid (every skill and kit, most-installed
// first). A static sibling of /browse/[category] so it wins routing over the
// dynamic category segment ('all' is never a category key).
async function BrowseAllContent({
  searchParams,
}: {
  searchParams: Promise<BrowseSearchParams>
}) {
  const sp = await searchParams
  const { q, offset, sort } = parseBrowseQuery(sp)
  return <BrowseGrid view="all" category="" q={q} offset={offset} sort={sort} />
}

export default function BrowseAllPage(props: { searchParams: Promise<BrowseSearchParams> }) {
  return (
    <DynamicPageBoundary>
      <BrowseAllContent {...props} />
    </DynamicPageBoundary>
  )
}
