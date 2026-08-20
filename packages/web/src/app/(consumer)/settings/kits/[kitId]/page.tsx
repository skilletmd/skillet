import { notFound, redirect } from 'next/navigation'
import { requireSession } from '@/lib/require-session'
import { getKit } from '@/lib/kits-server'
import { kitEditHref } from '@/lib/urls'

// Legacy URL. Kit editing now lives at the owner-namespaced `/{owner}/kit/{slug}/edit`
// (mirroring the public permalink and how skills are edited). Resolve the kit and
// 307 to the canonical edit URL so old bookmarks and links keep working.
export default async function LegacyKitSettingsRedirect({
  params,
}: {
  params: Promise<{ kitId: string }>
}) {
  const { kitId } = await params
  const session = await requireSession(`/settings/kits/${kitId}`)

  const result = await getKit(kitId)
  if (result.kind === 'not_found') notFound()
  if (result.kind !== 'ok') {
    redirect(session.handle ? `/${session.handle}` : '/')
  }

  redirect(kitEditHref(result.kit.owner, result.kit.slug))
}
