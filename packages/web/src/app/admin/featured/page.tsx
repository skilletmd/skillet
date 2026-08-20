import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { revalidatePath, revalidateTag } from 'next/cache'
import { CATALOG_TAGS } from '@/lib/catalog-tags'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { PageHeader } from '@/components/page-header'
import { SettingsSection } from '@/components/ui/setting-section'
import { SettingsList } from '@/components/ui/settings-list'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { AdminSearchAction } from '@/components/admin/admin-search-action'
import { adminGet, adminPost } from '../registry-admin'

export const metadata: Metadata = {
  title: 'Featured - Skillet',
  robots: { index: false, follow: false },
}

interface FeaturedData {
  skills: { id: string; author: string; slug: string }[]
  kits: { id: string; owner: string; slug: string; name: string }[]
}

// --- server actions -------------------------------------------------------

// Featuring writes go registry server-to-server (adminPost), bypassing the BFF
// proxy that normally busts the catalog cache. Flush the tags here so /browse and
// the home catalog reflect the change on the next read instead of waiting out the
// ~60s revalidate window.
function bustFeaturedCaches(): void {
  for (const tag of CATALOG_TAGS) revalidateTag(tag, 'max')
  revalidatePath('/admin/featured')
}

async function featureSkillById(id: string): Promise<void> {
  'use server'
  await adminPost(`/admin/skills/${id}/feature`, { featured: true })
  bustFeaturedCaches()
}

async function unfeatureSkill(id: string): Promise<void> {
  'use server'
  await adminPost(`/admin/skills/${id}/feature`, { featured: false })
  bustFeaturedCaches()
}

async function featureKitById(id: string): Promise<void> {
  'use server'
  await adminPost(`/admin/kits/${id}/feature`, { featured: true })
  bustFeaturedCaches()
}

async function unfeatureKit(id: string): Promise<void> {
  'use server'
  await adminPost(`/admin/kits/${id}/feature`, { featured: false })
  bustFeaturedCaches()
}

async function FeaturedContent() {
  await markDynamicRoute()
  const data = await adminGet<FeaturedData>('/admin/featured')

  if (!data) {
    return (
      <div>
        <PageHeader title="Featured" lede="Feature skills and kits at the top of browse." />
        <Notice tone="danger">Couldn’t load featured state. Try again.</Notice>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Featured"
        lede="Featured skills and kits lead the browse and home catalogs. Add one by reference; remove it to drop back into the normal ranking."
      />

      <div className="space-y-10">
        <SettingsSection
          title="Feature something"
          description="Search for a skill or kit, then confirm."
        >
          <AdminSearchAction
            verb="Feature"
            types={['skills', 'kits']}
            actions={{ skill: featureSkillById, kit: featureKitById }}
          />
        </SettingsSection>

        <SettingsSection title="Featured skills" description="Lead the skill catalog.">
          {data.skills.length === 0 ? (
            <p className="text-sm text-(--ink-2)">No featured skills.</p>
          ) : (
            <SettingsList>
              {data.skills.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <Link
                    href={`/${s.author}/${s.slug}`}
                    className="truncate font-mono text-sm text-(--ink) hover:underline"
                  >
                    {s.author}/{s.slug}
                  </Link>
                  <form action={unfeatureSkill.bind(null, s.id)}>
                    <Button type="submit" variant="secondary" size="sm">
                      Remove
                    </Button>
                  </form>
                </li>
              ))}
            </SettingsList>
          )}
        </SettingsSection>

        <SettingsSection title="Featured kits" description="Lead the kit catalog.">
          {data.kits.length === 0 ? (
            <p className="text-sm text-(--ink-2)">No featured kits.</p>
          ) : (
            <SettingsList>
              {data.kits.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 truncate text-sm text-(--ink)">
                    {k.name}{' '}
                    <span className="font-mono text-xs text-(--ink-2)">
                      {k.owner}/{k.slug}
                    </span>
                  </span>
                  <form action={unfeatureKit.bind(null, k.id)}>
                    <Button type="submit" variant="secondary" size="sm">
                      Remove
                    </Button>
                  </form>
                </li>
              ))}
            </SettingsList>
          )}
        </SettingsSection>
      </div>
    </div>
  )
}

export default function FeaturedPage() {
  return (
    <Suspense fallback={null}>
      <FeaturedContent />
    </Suspense>
  )
}
