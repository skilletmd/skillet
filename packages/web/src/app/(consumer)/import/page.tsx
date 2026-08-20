import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { requireSession } from '@/lib/require-session'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import { PAGE_CONTAINER_NARROW_CLASS } from '@/lib/page-layout'
import { RepoImportWizard } from '@/components/repo-import-wizard'
import { listOwnedRepos, type OwnedRepo } from '@/lib/github-repos'
import { listConnectedRepos, fetchOwnedReposViaRegistry } from '@/lib/connected-repos'
import { readSessionCookie } from '@/lib/session-cookie'
import { GH_REPO_TOKEN_COOKIE } from '@/app/api/github/connect/callback/route'
import { listMyOrgs } from '@/lib/orgs-server'
import { getAuthorProfile } from '@/lib/registry'
import { type PublishAsTarget } from '@/components/publish-as-control'

export const metadata = {
  title: 'Import from GitHub · Skillet',
  robots: { index: false },
}

async function ImportPageContent({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>
}) {
  const session = await requireSession('/import')
  if (!session.handle) {
    redirect('/settings')
  }

  const sp = await searchParams
  const url = (Array.isArray(sp.url) ? sp.url[0] : sp.url)?.trim()

  // For the "Sync my repo" mode: is GitHub connected, which repos can they sync,
  // and which are already syncing?
  const jar = await cookies()
  const repoToken = jar.get(GH_REPO_TOKEN_COOKIE)?.value
  const sessionToken = readSessionCookie(jar)
  const connectedRepos = sessionToken ? await listConnectedRepos(sessionToken) : []
  const connectedFulls = new Set(connectedRepos.map((r) => r.full))

  // Same one-connection resolution as /settings/github: a fresh grant cookie
  // lists BFF-side; otherwise the registry lists with the user's stored token, so
  // a GitHub-sign-in user can sync a repo without any extra grant.
  let connected = false
  let owned: OwnedRepo[] = []
  if (repoToken) {
    connected = true
    owned = await listOwnedRepos(repoToken)
  } else if (sessionToken) {
    const res = await fetchOwnedReposViaRegistry(sessionToken)
    connected = res.connected
    owned = res.repos
  }
  const available = owned.filter((r) => !connectedFulls.has(r.full))

  // Who the user can publish under: themselves + teams they own/admin (same rule
  // as the new-skill editor). Drives the "Publish as" picker; a solo user (no
  // teams) sees no picker and publishes as themselves.
  const [orgsResult, profile] = await Promise.all([
    listMyOrgs(),
    getAuthorProfile(session.handle, { withSession: true }),
  ])
  const publishableOrgs =
    orgsResult.kind === 'ok'
      ? orgsResult.orgs.filter((o) => o.role === 'owner' || o.role === 'admin')
      : []
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
    <main className={`marketing-home consumer-theme ${PAGE_CONTAINER_NARROW_CLASS}`}>
      {/* Key on the target repo so navigating between /import?url=… and a bare
          /import (Add manually) REMOUNTS the wizard fresh — a query-only change is
          a soft nav that would otherwise keep the previously-selected repo. */}
      <RepoImportWizard
        key={url || 'new'}
        author={session.handle}
        initialUrl={url}
        githubLinked={connected}
        available={available}
        connected={connectedRepos}
        publishTargets={publishTargets}
        sessionHandle={session.handle}
      />
    </main>
  )
}

export default function ImportPage(props: { searchParams: Promise<{ url?: string | string[] }> }) {
  return (
    <DynamicPageBoundary>
      <ImportPageContent {...props} />
    </DynamicPageBoundary>
  )
}
