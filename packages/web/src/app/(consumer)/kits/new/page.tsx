import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { requireSession } from '@/lib/require-session'
import { KitCreateForm, type PickerSkill } from '@/components/kits/kit-create-form'
import { getAuthorProfile } from '@/lib/registry'
import { getSkillCatalog } from '@/lib/registry-catalog'
import { listMyOrgs } from '@/lib/orgs-server'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { GitHubIcon } from '@/components/auth-provider-icons'
import { PageHeader } from '@/components/page-header'
import { type PublishAsTarget } from '@/components/publish-as-control'

export const metadata = {
  title: 'New kit · Skillet',
  robots: { index: false },
}

async function NewKitContent({
  searchParams,
}: {
  searchParams: Promise<{ team?: string | string[]; org?: string | string[] }>
}) {
  await markDynamicRoute()
  const session = await requireSession('/kits/new')
  if (!session.handle) {
    redirect('/settings')
  }

  // Teams you can publish under: owner/admin only. Powers the "Publish as" picker.
  const sp = await searchParams
  const requested = (
    (Array.isArray(sp.team) ? sp.team[0] : sp.team) ??
    (Array.isArray(sp.org) ? sp.org[0] : sp.org) ??
    ''
  )
    .trim()
    .toLowerCase()
  const orgsResult = await listMyOrgs()
  const publishableOrgs =
    orgsResult.kind === 'ok'
      ? orgsResult.orgs.filter((o) => o.role === 'owner' || o.role === 'admin')
      : []
  // Honor ?team= (or legacy ?org=) as the preselected owner only if you admin it;
  // otherwise default to a personal kit. The registry re-checks on create.
  const team = requested && publishableOrgs.some((o) => o.slug === requested) ? requested : null

  // Preload the curator's own and saved skills so the picker's "My skills" and
  // "Saved" tabs are instant — no typing required to start building a kit.
  const profile = await getAuthorProfile(session.handle, { withSession: true }).catch(() => null)
  const mySkills: PickerSkill[] = (profile?.skills ?? []).map((s) => ({
    skill_id: `${s.author}:${s.slug}`,
    author: s.author,
    slug: s.slug,
    description: s.description || null,
    category: s.category ?? null,
    visibility: s.visibility,
  }))
  const savedSkills: PickerSkill[] = (profile?.savedSkills ?? []).map((s) => {
    const [author, slug] = s.skill_id.split(':')
    return {
      skill_id: s.skill_id,
      author,
      slug,
      description: s.description ?? null,
      category: s.category ?? null,
    }
  })

  // Most-installed skills power the picker's "Popular" browse tab.
  const catalog = await getSkillCatalog({ limit: 18 }).catch(() => null)
  const popularSkills: PickerSkill[] = (catalog?.skills ?? []).map((s) => ({
    skill_id: s.skill_id,
    author: s.author,
    slug: s.slug,
    description: s.description ?? null,
    category: s.category ?? null,
  }))

  // "Publish as": yourself, plus any team you administer.
  const publishTargets: PublishAsTarget[] = [
    {
      handle: session.handle,
      name: profile?.displayName ?? session.handle,
      kind: 'you',
      avatarUrl: profile?.avatarUrl ?? session.user.image ?? null,
    },
    ...publishableOrgs.map((o) => ({ handle: o.slug, name: o.name, kind: 'team' as const })),
  ]

  return (
    <main className={`marketing-home consumer-theme ${PAGE_CONTAINER_CLASS}`}>
      <div className="mx-auto max-w-[640px]">
        <PageHeader
          title="New kit"
          action={
            <Link
              href="/import"
              className="flex items-center gap-1.5 rounded-lg border border-(--line) bg-(--surface) px-2.5 py-1.5 text-sm font-medium text-(--ink) transition hover:border-(--ink-2)"
            >
              <GitHubIcon className="h-4 w-4 text-(--ink-2)" />
              Import from GitHub
            </Link>
          }
        />
        <KitCreateForm
          mySkills={mySkills}
          savedSkills={savedSkills}
          popularSkills={popularSkills}
          publishTargets={publishTargets}
          sessionHandle={session.handle}
          initialAuthor={team ?? session.handle}
        />
      </div>
    </main>
  )
}

export default function NewKitPage(props: {
  searchParams: Promise<{ team?: string | string[]; org?: string | string[] }>
}) {
  return (
    <Suspense fallback={null}>
      <NewKitContent {...props} />
    </Suspense>
  )
}
