import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { PageHeader } from '@/components/page-header'
import { SettingsSection } from '@/components/ui/setting-section'
import { SettingsList } from '@/components/ui/settings-list'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Notice } from '@/components/ui/notice'
import { AdminSearchAction } from '@/components/admin/admin-search-action'
import { adminGet, adminPost } from '../registry-admin'

export const metadata: Metadata = {
  title: 'Moderation - Skillet',
  robots: { index: false, follow: false },
}

interface ModerationData {
  skills: { id: string; author: string; slug: string; moderation_status: string }[]
  kits: { id: string; owner: string; slug: string; name: string }[]
  suspended: { handle: string; suspended_at: number }[]
}

// --- server actions -------------------------------------------------------

async function hideUserByHandle(handle: string): Promise<void> {
  'use server'
  await adminPost(`/admin/users/${encodeURIComponent(handle)}/suspend`, { suspend: true })
  revalidatePath('/admin/moderation')
}

async function unsuspendUser(handle: string): Promise<void> {
  'use server'
  await adminPost(`/admin/users/${encodeURIComponent(handle)}/suspend`, { suspend: false })
  revalidatePath('/admin/moderation')
}

async function hideSkillById(id: string): Promise<void> {
  'use server'
  await adminPost(`/admin/skills/${id}/moderate`, { action: 'unlist' })
  revalidatePath('/admin/moderation')
}

async function relistSkill(id: string): Promise<void> {
  'use server'
  await adminPost(`/admin/skills/${id}/moderate`, { action: 'relist' })
  revalidatePath('/admin/moderation')
}

async function hideKitById(id: string): Promise<void> {
  'use server'
  await adminPost(`/admin/kits/${id}/moderate`, { action: 'hide' })
  revalidatePath('/admin/moderation')
}

async function unhideKit(id: string): Promise<void> {
  'use server'
  await adminPost(`/admin/kits/${id}/moderate`, { action: 'unhide' })
  revalidatePath('/admin/moderation')
}

async function ModerationContent() {
  await markDynamicRoute()
  const data = await adminGet<ModerationData>('/admin/moderation')

  if (!data) {
    return (
      <div>
        <PageHeader title="Moderation" lede="Hide a skill, kit, or whole user from browse." />
        <Notice tone="danger">Couldn’t load moderation state. Try again.</Notice>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Moderation"
        lede="Hide a skill, kit, or a whole user from search and browse. Hiding a user also hides all of their skills and kits. Everything is reversible."
      />

      <div className="space-y-10">
        <SettingsSection
          title="Hide something"
          description="Search for a skill, kit, or user, then confirm. Hiding a user hides all their content."
        >
          <AdminSearchAction
            verb="Hide"
            danger
            types={['skills', 'kits', 'authors']}
            actions={{ skill: hideSkillById, kit: hideKitById, author: hideUserByHandle }}
          />
        </SettingsSection>

        <SettingsSection title="Suspended users" description="Their skills and kits are hidden.">
          {data.suspended.length === 0 ? (
            <p className="text-sm text-(--ink-2)">No suspended users.</p>
          ) : (
            <SettingsList>
              {data.suspended.map((u) => (
                <li key={u.handle} className="flex items-center justify-between gap-3 px-4 py-3">
                  <Link href={`/${u.handle}`} className="truncate font-mono text-sm text-(--accent) hover:underline">
                    @{u.handle}
                  </Link>
                  <form action={unsuspendUser.bind(null, u.handle)}>
                    <Button type="submit" variant="secondary" size="sm">
                      Unhide
                    </Button>
                  </form>
                </li>
              ))}
            </SettingsList>
          )}
        </SettingsSection>

        <SettingsSection title="Hidden skills" description="Unlisted or quarantined.">
          {data.skills.length === 0 ? (
            <p className="text-sm text-(--ink-2)">No hidden skills.</p>
          ) : (
            <SettingsList>
              {data.skills.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <Link
                      href={`/${s.author}/${s.slug}`}
                      className="truncate font-mono text-sm text-(--ink) hover:underline"
                    >
                      {s.author}/{s.slug}
                    </Link>
                    <Badge variant="default">{s.moderation_status}</Badge>
                  </span>
                  <form action={relistSkill.bind(null, s.id)}>
                    <Button type="submit" variant="secondary" size="sm">
                      Unhide
                    </Button>
                  </form>
                </li>
              ))}
            </SettingsList>
          )}
        </SettingsSection>

        <SettingsSection title="Hidden kits" description="Removed from browse.">
          {data.kits.length === 0 ? (
            <p className="text-sm text-(--ink-2)">No hidden kits.</p>
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
                  <form action={unhideKit.bind(null, k.id)}>
                    <Button type="submit" variant="secondary" size="sm">
                      Unhide
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

export default function ModerationPage() {
  return (
    <Suspense fallback={null}>
      <ModerationContent />
    </Suspense>
  )
}
