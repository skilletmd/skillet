import Image from 'next/image'
import { cookies } from 'next/headers'
import { signIn } from '@/auth'
import { readAuthGithubCredentials } from '@/lib/oauth-env'
import { requireSession } from '@/lib/require-session'
import { readSessionCookie } from '@/lib/session-cookie'
import { fetchRegistryWhoami } from '@/lib/registry-session'
import { listConnectedRepos, fetchOwnedReposViaRegistry } from '@/lib/connected-repos'
import { ConnectRepoPanel } from '@/components/connect-repo-panel'
import { LinkedAccountMenu } from '@/components/linked-account-menu'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { SettingsList } from '@/components/ui/settings-list'
import { SettingRow } from '@/components/ui/setting-row'
import { GitHubIcon } from '@/components/auth-provider-icons'
import { PageHeader } from '@/components/page-header'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'

export const metadata = {
  title: 'GitHub · Skillet',
  robots: { index: false },
}

/** The user's @login as a link to their GitHub profile (new tab). */
function githubProfileLink(login: string) {
  return (
    <a
      href={`https://github.com/${login}`}
      target="_blank"
      rel="noopener noreferrer"
      className="underline-offset-2 hover:underline"
    >
      @{login}
    </a>
  )
}

const ERRORS: Record<string, string> = {
  github_unconfigured: 'GitHub is not configured on this instance.',
  oauth_state: 'That attempt expired. Try connecting again.',
  oauth_exchange: 'Could not reach GitHub. Try again.',
  oauth_no_token: 'GitHub did not return access. Try again.',
}

async function GithubSettingsPageContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string; linked?: string }>
}) {
  const session = await requireSession('/settings/github')

  // No GitHub OAuth credentials means Auth.js never registered the provider, so
  // signIn('github') would fall through its unknown-provider path and bounce the
  // user to /login (and from there to the post-login default) with no error.
  // Say so instead of rendering a button that silently goes nowhere.
  const githubConfigured = readAuthGithubCredentials() != null

  const sp = await searchParams
  const jar = await cookies()
  const sessionToken = readSessionCookie(jar)
  const [whoami, repos, owned] = await Promise.all([
    sessionToken ? fetchRegistryWhoami(sessionToken) : Promise.resolve(null),
    sessionToken ? listConnectedRepos(sessionToken) : Promise.resolve([]),
    sessionToken
      ? fetchOwnedReposViaRegistry(sessionToken)
      : Promise.resolve({ connected: false, repos: [], user: null }),
  ])
  const connectedFulls = new Set(repos.map((r) => r.full))
  // The caller's owned public repos not already synced — shown as one-click
  // "add" rows that deep-link into the import wizard (skill selection).
  const available = owned.repos.filter((r) => !connectedFulls.has(r.full))

  // The GitHub *account* connection — a fresh registry signal, INDEPENDENT of
  // repos. Disconnecting a repo must never read as disconnecting GitHub; only the
  // connection card's Disconnect does that. Fall back to the session flag if the
  // registry is unreachable, and to a stored token / synced repos for legacy.
  const connected =
    (whoami?.github_linked ?? session.githubLinked) === true ||
    owned.connected ||
    repos.length > 0
  // The user's GitHub identity, straight from GitHub (not their Skillet alias):
  // the login for "@handle" and the real display name to head the card.
  const login = owned.user?.login ?? repos[0]?.owner ?? available[0]?.owner ?? null
  const displayName = owned.user?.name && owned.user.name !== login ? owned.user.name : null

  // ?linked=github means the OAuth round-tripped — not that the link took (it may
  // already belong to another Skillet user). Confirm against the real state.
  const linkConfirmed = sp.linked === 'github' && connected
  const banner =
    sp.linked === 'github'
      ? linkConfirmed
        ? 'Connected GitHub.'
        : 'That GitHub account is already linked to another Skillet user.'
      : sp.error && ERRORS[sp.error]
        ? ERRORS[sp.error]
        : null
  const bannerDanger = (sp.linked === 'github' && !linkConfirmed) || !!sp.error

  return (
    <div>
      <PageHeader
        title="GitHub"
        lede="Publish and share skills stored in your GitHub repos."
      />

      {banner && (
        <Notice tone={bannerDanger ? 'danger' : 'success'} className="mb-6">
          {banner}
        </Notice>
      )}

      {connected ? (
        <div className="space-y-10">
          {/* The connection itself: one row, with Disconnect a layer down. */}
          <SettingsList>
            <SettingRow
              as="li"
              icon={
                login ? (
                  // Avatar with the GitHub mark as a corner badge — signals the
                  // platform without a separate logo or URL line.
                  <span className="relative inline-flex">
                    <Image
                      src={`https://github.com/${login}.png`}
                      alt=""
                      width={40}
                      height={40}
                      className="h-10 w-10 rounded-full border border-(--line) bg-(--bg)"
                    />
                    <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-(--surface) ring-2 ring-(--surface)">
                      <GitHubIcon className="h-3.5 w-3.5 text-(--ink)" />
                    </span>
                  </span>
                ) : (
                  <GitHubIcon className="h-5 w-5" />
                )
              }
              title={
                displayName ? displayName : login ? githubProfileLink(login) : 'GitHub'
              }
              description={
                displayName && login ? githubProfileLink(login) : login ? undefined : 'Connected'
              }
            >
              <LinkedAccountMenu provider="github" label="GitHub" />
            </SettingRow>
          </SettingsList>

          {/* The repos it syncs + your other repos to add (both hand off to the
              import wizard for skill selection). */}
          <ConnectRepoPanel repos={repos} available={available} />
        </div>
      ) : (
        <EmptyState
          variant="card"
          illustration={
            <Image
              src="/illustrations/empty-github.png"
              alt=""
              width={266}
              height={240}
              className="empty-illo h-24 w-auto"
            />
          }
          caption="Read-only. Skillet never modifies your code."
          action={
            githubConfigured ? (
              <form
                action={async () => {
                  'use server'
                  await signIn('github', { redirectTo: '/settings/github?linked=github' })
                }}
              >
                <Button type="submit" variant="primary" size="lg">
                  <GitHubIcon className="h-[18px] w-[18px]" />
                  Connect GitHub
                </Button>
              </form>
            ) : (
              <Notice tone="danger">{ERRORS.github_unconfigured}</Notice>
            )
          }
        />
      )}
    </div>
  )
}

export default function GithubSettingsPage(props: {
  searchParams: Promise<{ error?: string; connected?: string; linked?: string }>
}) {
  return (
    <DynamicPageBoundary>
      <GithubSettingsPageContent {...props} />
    </DynamicPageBoundary>
  )
}
