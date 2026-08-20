import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { getSession } from '@/lib/get-session'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import { HomeCatalogShelves } from '@/components/home/home-shelves'
import { CatalogShelvesSkeleton } from '@/components/home/shelf-skeleton'
import { ogMeta, OG } from '@/lib/og'
import {
  BROWSE_SSR_RID_HEADER,
  browseSsrLog,
  browseSsrSpan,
  isBrowseSsrProbeEnabled,
  withBrowseSsrProbe,
} from '@/lib/browse-ssr-probe'

export const metadata: Metadata = {
  title: 'Featured AI agent skills · Skillet',
  description:
    'Hand-picked skills and kits for AI agents like Claude, Codex, and Cursor, plus the top skills and creators on Skillet. Browse the full catalog under All Skills.',
  ...ogMeta(OG.skills()),
}

// /browse is the curated Featured view (the All Skills grid lives at /browse/all).
// Reuses the homepage catalog shelves at the fuller default size (top-10 charts).
async function FeaturedContent() {
  let rid: string | undefined
  if (isBrowseSsrProbeEnabled()) {
    const h = await headers()
    rid = h.get(BROWSE_SSR_RID_HEADER) ?? undefined
  }

  return withBrowseSsrProbe(async () => {
    browseSsrLog('featured_enter', {})
    const session = await browseSsrSpan('featured_session', () => getSession())
    const shelves = await browseSsrSpan('featured_shelves', () =>
      HomeCatalogShelves({
        viewerHandle: session?.handle ?? null,
        seeAll: false,
        kitCount: 3,
        ssrViewerFollows: false,
      }),
    )
    browseSsrLog('featured_done', { has_handle: Boolean(session?.handle) })
    return shelves
  }, rid)
}

export default function BrowsePage() {
  return (
    <DynamicPageBoundary fallback={<CatalogShelvesSkeleton kitCount={3} seeAll={false} />}>
      <FeaturedContent />
    </DynamicPageBoundary>
  )
}
