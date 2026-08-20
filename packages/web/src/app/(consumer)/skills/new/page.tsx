import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/require-session'
import { SkillCreateWorkspace } from '@/components/skill-create-workspace'
import { type SkillPublishTarget } from '@/components/skill-studio-editor'
import { listMyOrgs } from '@/lib/orgs-server'
import { getAuthorProfile } from '@/lib/registry'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'

export const metadata = {
  title: 'Create skill · Skillet',
  robots: { index: false },
}

export default async function NewSkillPage({
  searchParams,
}: {
  searchParams: Promise<{
    team?: string | string[]
    org?: string | string[]
    import?: string | string[]
  }>
}) {
  const session = await requireSession('/skills/new')
  if (!session.handle) {
    redirect('/settings')
  }

  const sp = await searchParams
  // ?team= is the current param; ?org= is kept as a back-compat alias.
  const org = (
    (Array.isArray(sp.team) ? sp.team[0] : sp.team) ?? (Array.isArray(sp.org) ? sp.org[0] : sp.org)
  )
    ?.trim()
    .toLowerCase()
  const importMode = (Array.isArray(sp.import) ? sp.import[0] : sp.import) === '1'

  // Teams the user can actually publish under: owner/admin only (members can't).
  const [orgsResult, profile] = await Promise.all([
    listMyOrgs(),
    getAuthorProfile(session.handle, { withSession: true }),
  ])
  const publishableOrgs =
    orgsResult.kind === 'ok'
      ? orgsResult.orgs.filter((o) => o.role === 'owner' || o.role === 'admin')
      : []

  const publishTargets: SkillPublishTarget[] = [
    {
      handle: session.handle,
      name: profile?.displayName ?? session.handle,
      kind: 'you',
      avatarUrl: profile?.avatarUrl ?? session.user.image ?? null,
    },
    ...publishableOrgs.map((o) => ({ handle: o.slug, name: o.name, kind: 'team' as const })),
  ]

  // Honor ?org= only if you can publish there; otherwise fall back to yourself.
  const author = org && publishableOrgs.some((o) => o.slug === org) ? org : session.handle

  return (
    <main className={`marketing-home consumer-theme ${PAGE_CONTAINER_CLASS}`}>
      <SkillCreateWorkspace
        author={author}
        publishTargets={publishTargets}
        orgMode={author !== session.handle}
        sessionHandle={session.handle}
        initialImportOpen={importMode}
      />
    </main>
  )
}
