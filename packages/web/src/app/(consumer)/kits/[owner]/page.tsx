import { notFound, redirect } from 'next/navigation'
import { getKit } from '@/lib/kits-server'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import { kitHref } from '@/lib/urls'

interface Params {
  owner: string
}

/**
 * Legacy permalink. Named kits now live at `/{owner}/kit/{slug}`; a bare single
 * segment under /kits is only ever an old UUID, so resolve it and redirect to
 * the canonical owner-namespaced URL. (Param is named `owner` to match the
 * `[owner]/[slug]` sibling — Next.js requires one slug name per dynamic level —
 * but it carries a legacy kit id.)
 */
async function LegacyKitRedirectContent({ params }: { params: Promise<Params> }) {
  const { owner: kitId } = await params
  const result = await getKit(kitId)
  // A slug-less kit (pre-backfill registry) would build `/{owner}/kit/null`;
  // 404 beats redirecting to a broken URL.
  if (result.kind !== 'ok' || !result.kit.slug) notFound()
  redirect(kitHref(result.kit.owner, result.kit.slug))
  return null
}

export default function LegacyKitRedirect(props: { params: Promise<Params> }) {
  return (
    <DynamicPageBoundary>
      <LegacyKitRedirectContent {...props} />
    </DynamicPageBoundary>
  )
}
